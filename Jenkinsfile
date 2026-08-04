pipeline {
    agent any

    environment {
        // Shared workspace mappings
        ECR_REPO_NAME  = "gym-auth-service"
        KUBERNETES_DIR = "${WORKSPACE}/k8s/prod"
        NAMESPACE      = "gym-dev"
        AWS_REGION     = "us-east-1"
        
        // Safe evaluation fallback for Git SHA
        IMAGE_TAG      = "${env.GIT_COMMIT ? env.GIT_COMMIT.take(7) : 'latest'}"

        // Jenkins Credentials Store bindings (Available globally across all stages & post block)
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
            agent {
                docker { image 'node:20-alpine' }
            }
            steps {
                sh 'npm install'
            }
        }

        stage('ECR Authentication') {
            steps {
                echo '🔐 Authenticating Docker daemon with AWS ECR...'
                sh "aws ecr get-login-password --region ${env.AWS_REGION} | docker login --username AWS --password-stdin ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com"
            }
        }

        stage('Build Container Image') {
            steps {
                echo "🏭 Building Docker image tagged as: ${env.IMAGE_TAG}..."
                sh "docker build -t ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:${env.IMAGE_TAG} ."
                sh "docker tag ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:${env.IMAGE_TAG} ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:latest"
            }
        }

        stage('Push Image to AWS ECR') {
            steps {
                echo "🚀 Pushing image artifact [${env.IMAGE_TAG}] to AWS ECR..."
                sh "docker push ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:${env.IMAGE_TAG}"
                sh "docker push ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:latest"
            }
        }

        stage('Authenticate to EKS') {
            steps {
                echo '🛡️ Updating cluster context connection...'
                sh "aws eks update-kubeconfig --region ${env.AWS_REGION} --name gym-cluster-dev"
            }
        }

        stage('Run Database Migration') {
            steps {
                echo '🔐 Ensuring ExternalSecret & ConfigMap exist before DB Job execution...'
                sh "kubectl apply -f ${env.KUBERNETES_DIR}/configmap.yaml"
                sh "kubectl apply -f ${env.KUBERNETES_DIR}/external-secret.yaml"
                sh "kubectl apply -f ${env.KUBERNETES_DIR}/db-schema-configmap.yaml"
                
                echo '🗄️ Triggering database schema migration Job...'
                sh "kubectl delete job auth-db-migrate -n ${env.NAMESPACE} --ignore-not-found"
                sh "kubectl apply -f ${env.KUBERNETES_DIR}/db-migrate-job.yaml"
                sh "kubectl wait --for=condition=complete job/auth-db-migrate -n ${env.NAMESPACE} --timeout=90s"
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                echo '🚀 Deploying Auth Service rollout update...'
                sh """
                    temp_manifest=\$(mktemp)
                    
                    sed -e "s|<account-id>|${env.AWS_ACCOUNT_ID}|g" \
                        -e "s|<region>|${env.AWS_REGION}|g" \
                        -e "s|:latest|:${env.IMAGE_TAG}|g" \
                        ${env.KUBERNETES_DIR}/deployment.yaml > \$temp_manifest

                    kubectl apply -f \$temp_manifest
                    kubectl apply -f ${env.KUBERNETES_DIR}/service.yaml
                    
                    rm -f \$temp_manifest

                    kubectl rollout status deployment/auth-service -n ${env.NAMESPACE} --timeout=90s
                """
            }
        }

        // stage('Smoke Test') {
        //     steps {
        //         echo '🧪 Executing active endpoint smoke test...'
        //         sh """
        //             kubectl run smoke-test-auth --rm -i --restart=Never --image=curlimages/curl -n ${env.NAMESPACE} -- \
        //                 curl -sf http://auth-service:4000/health
        //         """
        //     }
        // }
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
            // sh "
            //     kubectl delete pod smoke-test-auth -n ${env.NAMESPACE} --ignore-not-found || true
            // "
        }
    }
}