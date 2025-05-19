#!/bin/bash

# Set variables for image and container names
IMAGE_NAME="inventoryflow-app"
CONTAINER_NAME="inventoryflow-app-container"

# Step 1: Remove old images and containers
echo "Stopping and removing any running containers with the name $CONTAINER_NAME..."
docker stop $CONTAINER_NAME || true
docker rm $CONTAINER_NAME || true

echo "Removing old Docker images with the name $IMAGE_NAME..."
docker rmi $(docker images -q $IMAGE_NAME) || true

# Step 2: Build new Docker image
echo "Building a new Docker image: $IMAGE_NAME..."
docker build -t $IMAGE_NAME .

# Step 3: Run the project with restart policy and log rotation
echo "Running the new container with the name $CONTAINER_NAME..."
docker run -d --name $CONTAINER_NAME \
  --restart unless-stopped \
  --log-driver=json-file \
  --log-opt max-size=5m \
  --log-opt max-file=1 \
  -p 6005:6004 \
  $IMAGE_NAME

echo "Deployment completed successfully."

# Step 4: Monitor container logs (optional)
echo "To check logs, run: docker logs -f $CONTAINER_NAME"