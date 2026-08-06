docker build -t registry.digitalocean.com/rewaldo-registery/mlitech-backend:latest .
docker push registry.digitalocean.com/rewaldo-registery/mlitech-backend:latest

doctl compute ssh mlitech-app-1
docker pull registry.digitalocean.com/rewaldo-registery/mlitech-backend:latest
docker rm -f mlitech-backend
docker run -d \
  --name mlitech-backend \
  --restart unless-stopped \
  -p 5004:5004 \
  --env-file .env.production \
  registry.digitalocean.com/rewaldo-registery/mlitech-backend:latest

  docker logs mlitech-backend --tail 20
  
   docker logs mlitech-backend --tail 20
✅ Firebase Admin initialized successfully
Warning: connect.session() MemoryStore is not
designed for a production environment, as it will leak
memory, and will not scale past a single process.
Fri Jul 24 2026 6:26:58 [PROJECT_NAME] info: 🚀 Database connected successfully
Fri Jul 24 2026 6:26:58 [PROJECT_NAME] info: [CRON] All cron jobs registered successfully
Fri Jul 24 2026 6:26:58 [PROJECT_NAME] info: Worker 1 listening on port:5004
Fri Jul 24 2026 6:27:7 [PROJECT_NAME] info: GET / 200 - 14.840 ms
Fri Jul 24 2026 6:27:7 [PROJECT_NAME] info: HTTP Request
