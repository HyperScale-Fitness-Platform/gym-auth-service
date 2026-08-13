pipeline {
    agent {
        kubernetes {
            yaml '''
            apiVersion: v1
            kind: Pod
            spec:
              containers:
              - name: node
                image: node:20-alpine
                command:
                - cat
                tty: true
              - name: docker
                image: docker:24-dind
                securityContext:
                  privileged: true
                env:
                - name: DOCKER_TLS_CERTDIR
                  value: ""
              - name: aws-k8s
                image: alpine/k8s:1.30.0
                command:
                - cat
                tty: true
            '''
        }
    }

    environment {
        ECR_REPO_NAME  = "gym-auth-service"
        KUBERNETES_DIR = "${WORKSPACE}/k8s/prod"
        NAMESPACE      = "gym-dev"
        AWS_REGION     = "us-east-1"
        
        IMAGE_TAG      = "${env.GIT_COMMIT ? env.GIT_COMMIT.take(7) : 'latest'}"

        AWS_ACCESS_KEY_ID     = credentials('aws-access-key-id')
        AWS_SECRET_ACCESS_KEY = credentials('aws-secret-access-key')
        AWS_ACCOUNT_ID        = credentials('aws-account-id')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                // Route to the Node container
                container('node') {
                    sh 'npm install'
                }
            }
        }

        stage('ECR Authentication') {
            steps {
                // Route to the Docker container
                container('docker') {
                    sh '''
                        # Wait for the DinD daemon to initialize before interacting with it
                        until docker info >/dev/null 2>&1; do echo "Waiting for docker daemon..."; sleep 2; done
                        
                        # The docker image is alpine-based; install aws-cli quickly to get the ECR password
                        apk add --no-cache aws-cli
                    '''
                    echo '🔐 Authenticating Docker daemon with AWS ECR...'
                    sh "aws ecr get-login-password --region ${env.AWS_REGION} | docker login --username AWS --password-stdin ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com"
                }
            }
        }

        stage('Build Container Image') {
            steps {
                container('docker') {
                    echo "🏭 Building Docker image tagged as: ${env.IMAGE_TAG}..."
                    sh "docker build -t ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:${env.IMAGE_TAG} ."
                    sh "docker tag ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:${env.IMAGE_TAG} ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:latest"
                }
            }
        }

        stage('Push Image to AWS ECR') {
            steps {
                container('docker') {
                    echo "🚀 Pushing image artifact [${env.IMAGE_TAG}] to AWS ECR..."
                    sh "docker push ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:${env.IMAGE_TAG}"
                    sh "docker push ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:latest"
                }
            }
        }

        stage('Authenticate to EKS') {
            steps {
                // Route to the AWS/K8s tools container
                container('aws-k8s') {
                    echo '🛡️ Updating cluster context connection...'
                    sh "aws eks update-kubeconfig --region ${env.AWS_REGION} --name gym-cluster"
                }
            }
        }

        stage('Run Database Migration') {
            steps {
                container('aws-k8s') {
                    echo '🔐 Ensuring ExternalSecret & ConfigMap exist before DB Job execution...'
                    sh "kubectl apply -f ${env.KUBERNETES_DIR}/configmap.yaml"
                    sh "kubectl apply -f ${env.KUBERNETES_DIR}/secret.yaml"
                    sh "kubectl apply -f ${env.KUBERNETES_DIR}/db-schema-configmap.yaml"
                    
                    echo '⏳ Waiting for Kubernetes secret synchronization...'
                    sh """
                        for i in \$(seq 1 12); do
                            if kubectl get secret auth-svc-credentials -n ${env.NAMESPACE} >/dev/null 2>&1; then
                                echo "✅ Secret auth-svc-credentials present!"
                                break
                            fi
                            echo "Waiting for auth-svc-credentials secret creation..."
                            sleep 5
                        done
                    """

                    echo '🗄️ Fetching RDS endpoint dynamically & triggering migration Job...'
                    sh """
                        RDS_HOST=\$(aws rds describe-db-instances \
                            --region ${env.AWS_REGION} \
                            --query "DBInstances[?contains(DBInstanceIdentifier, 'auth-postgres')].Endpoint.Address" \
                            --output text)

                        if [ -z "\$RDS_HOST" ] || [ "\$RDS_HOST" = "None" ]; then
                            RDS_HOST=\$(aws rds describe-db-instances --region ${env.AWS_REGION} --query "DBInstances[0].Endpoint.Address" --output text)
                        fi

                        echo "Connecting to RDS Host: \$RDS_HOST"

                        temp_job=\$(mktemp)
                        
                        sed -e "s|<db-endpoint>|\$RDS_HOST|g" \
                            -e "s|<region>|${env.AWS_REGION}|g" \
                            -e "s|<account-id>|${env.AWS_ACCOUNT_ID}|g" \
                            ${env.KUBERNETES_DIR}/db-migrate-job.yaml > \$temp_job

                        kubectl delete job auth-db-migrate -n ${env.NAMESPACE} --ignore-not-found
                        kubectl apply -f \$temp_job
                        rm -f \$temp_job

                        kubectl wait --for=condition=complete job/auth-db-migrate -n ${env.NAMESPACE} --timeout=120s
                    """
                }
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                container('aws-k8s') {
                    echo '🚀 Deploying Auth Service & Dynamic Configurations...'
                    sh """
                        RDS_HOST=\$(aws rds describe-db-instances \
                            --region ${env.AWS_REGION} \
                            --query "DBInstances[?contains(DBInstanceIdentifier, 'auth-postgres')].Endpoint.Address" \
                            --output text)

                        if [ -z "\$RDS_HOST" ] || [ "\$RDS_HOST" = "None" ]; then
                            echo "⚠️ Fallback: Querying first available RDS instance"
                            RDS_HOST=\$(aws rds describe-db-instances --region ${env.AWS_REGION} --query "DBInstances[0].Endpoint.Address" --output text)
                        fi

                        echo "Injecting RDS Host into ConfigMap: \$RDS_HOST"

                        temp_cm=\$(mktemp)
                        sed "s|<db-endpoint>|\$RDS_HOST|g" ${env.KUBERNETES_DIR}/configmap.yaml > \$temp_cm
                        kubectl apply -f \$temp_cm
                        rm -f \$temp_cm

                        temp_deployment=\$(mktemp)
                        sed -e "s|<account-id>|${env.AWS_ACCOUNT_ID}|g" \
                            -e "s|<region>|${env.AWS_REGION}|g" \
                            -e "s|:latest|:${env.IMAGE_TAG}|g" \
                            ${env.KUBERNETES_DIR}/deployment.yaml > \$temp_deployment

                        kubectl apply -f \$temp_deployment
                        kubectl apply -f ${env.KUBERNETES_DIR}/service.yaml
                        rm -f \$temp_deployment

                        kubectl rollout restart deployment/auth-service -n ${env.NAMESPACE}
                        kubectl rollout status deployment/auth-service -n ${env.NAMESPACE} --timeout=90s
                    """
                }
            }
        }
    }

    post {
        success {
            echo "✅ auth-service:${env.IMAGE_TAG} successfully deployed and healthy!"
        }
        failure {
            echo "❌ Deployment failed! Check the step diagnostics above."
        }
        always {
            sh "rm -f /tmp/auth-deployment-resolved.yaml || true"
        }
    }
}