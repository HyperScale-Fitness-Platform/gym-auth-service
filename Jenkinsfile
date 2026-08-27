pipeline {
    agent any

    parameters {
        choice(
            name: 'ENVIRONMENT',
            choices: ['dev', 'prod'],
            description: 'Target environment'
        )
    }

    environment {
        ECR_REPO_NAME  = "gym-auth-service"
        AWS_REGION     = "us-east-1"
        CLUSTER_NAME   = "gym-cluster"
        SECRET_NAME    = "gym/dev/auth-db-credentials"

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
            agent {
                docker { image 'node:20-alpine' }
            }
            steps {
                sh 'npm install'
            }
        }

        stage('ECR Authentication') {
            steps {
                echo 'Authenticating Docker daemon with AWS ECR...'
                sh "aws ecr get-login-password --region ${env.AWS_REGION} | docker login --username AWS --password-stdin ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com"
            }
        }

        stage('Build Container Image') {
            steps {
                echo "Building Docker image tagged as: ${env.IMAGE_TAG}..."
                sh """
                    docker build -t ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:${env.IMAGE_TAG} .
                    docker tag ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:${env.IMAGE_TAG} ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:latest
                """
            }
        }

        stage('Push Image to AWS ECR') {
            steps {
                echo "Pushing image artifact [${env.IMAGE_TAG}] to AWS ECR..."
                sh """
                    docker push ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:${env.IMAGE_TAG}
                    docker push ${env.AWS_ACCOUNT_ID}.dkr.ecr.${env.AWS_REGION}.amazonaws.com/${env.ECR_REPO_NAME}:latest
                """
            }
        }

        stage('Sync Credentials to AWS Secrets Manager') {
            steps {
                echo 'Ensuring Postgres credentials exist in AWS Secrets Manager...'
                withCredentials([usernamePassword(credentialsId: 'auth-postgres-credentials', usernameVariable: 'DB_USER', passwordVariable: 'DB_PASSWORD')]) {
                    sh '''
                        if aws secretsmanager describe-secret --secret-id "${SECRET_NAME}" > /dev/null 2>&1; then
                            echo "Secret '${SECRET_NAME}' exists. Updating..."
                            aws secretsmanager put-secret-value \
                                --secret-id "${SECRET_NAME}" \
                                --secret-string "{\"username\":\"${DB_USER}\",\"password\":\"${DB_PASSWORD}\"}"
                        else
                            echo "Creating secret '${SECRET_NAME}'..."
                            aws secretsmanager create-secret \
                                --name "${SECRET_NAME}" \
                                --secret-string "{\"username\":\"${DB_USER}\",\"password\":\"${DB_PASSWORD}\"}"
                        fi
                    '''
                }
            }
        }
    }

    post {
        success {
            echo "gym-auth-service:${env.IMAGE_TAG} build complete and secrets synced!"
        }
        failure {
            echo "Pipeline failed! Check step diagnostics above."
        }
    }
}
