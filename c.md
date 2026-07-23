doctl compute ssh mlitech-app-1
docker pull registry.digitalocean.com/mlitech-registry/mlitech-backend:latest
docker rm -f mlitech-backend
docker run -d \
  --name mlitech-backend \
  --restart unless-stopped \
  -p 5004:5004 \
  --env-file .env.production \
  registry.digitalocean.com/mlitech-registry/mlitech-backend:latest
  docker logs mlitech-backend --tail 20