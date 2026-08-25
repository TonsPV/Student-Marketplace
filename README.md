# Student Marketplace API

Môi trường development local cho NestJS và PostgreSQL. Mỗi thành viên chạy môi trường riêng trên máy của mình, làm task rồi commit/push code lên Git.

## Yêu cầu

- Docker Desktop hoặc Docker Engine với Docker Compose v2
- Node.js 22.23.2 nếu chạy NestJS trực tiếp trên máy (`.nvmrc` đã được thêm)

Kiểm tra:

```bash
docker compose version
node --version
npm --version
```

## Thiết lập lần đầu

Tạo cấu hình local từ file mẫu. File `.env` không được commit:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```bash
# macOS / Linux
cp .env.example .env
```

## Cách chạy

### Cách 1: chạy cả NestJS và PostgreSQL bằng Docker

```bash
docker compose up -d --build --wait
```

API chạy tại `http://127.0.0.1:3000`.

### Cách 2: chỉ chạy PostgreSQL bằng Docker, NestJS chạy trên máy

```bash
docker compose up -d postgres --wait
npm ci
npm run start:dev
```

## Kiểm tra môi trường

- `GET /api`: kiểm tra API đã chạy.
- `GET /api/health`: kiểm tra API và thực hiện `SELECT 1` trên PostgreSQL.

```bash
curl http://127.0.0.1:3000/api
curl http://127.0.0.1:3000/api/health
```

## Biến môi trường local

| Biến | Mục đích |
| --- | --- |
| `NODE_ENV` | Môi trường chạy, mặc định `development` |
| `APP_PORT` | Port API trên máy host khi chạy Docker, mặc định `3000` |
| `POSTGRES_HOST` | Host PostgreSQL khi chạy trực tiếp, thường là `127.0.0.1` |
| `POSTGRES_PORT` | Port PostgreSQL trên máy host, mặc định `5432` |
| `POSTGRES_USER` | User PostgreSQL local |
| `POSTGRES_PASSWORD` | Password PostgreSQL local |
| `POSTGRES_DB` | Tên database local |

Khi chạy trong Compose, API tự dùng `postgres:5432` làm host/port nội bộ.

## Lệnh thường dùng

```bash
# Xem log
docker compose logs -f api
docker compose logs -f postgres

# Kiểm tra trạng thái
docker compose ps

# Rebuild sau khi thay package hoặc Dockerfile
docker compose up -d --build --wait

# Dừng container, giữ dữ liệu database local
docker compose stop

# Xóa container/network, giữ volume database local
docker compose down
```

Reset database local khi cần làm lại từ đầu:

```bash
docker compose down -v
docker compose up -d --build --wait
```

> **Cảnh báo:** `docker compose down -v` xóa volume database local và không thể hoàn tác.

Các biến `POSTGRES_USER`, `POSTGRES_PASSWORD` và `POSTGRES_DB` chỉ được dùng khi volume được khởi tạo lần đầu. Sửa chúng trong `.env` không tự cập nhật database đã tồn tại.

## Quy tắc Git

- Chỉ commit code, file cấu hình mẫu và dependency lockfile cần thiết.
- Không commit `.env` hoặc credential thật.
- Trước khi push task, chạy:

```bash
npm run format:check
npm run build
```

Hiện tại project dùng PostgreSQL driver `pg` và chưa chọn ORM. TypeORM hoặc Prisma sẽ được thêm sau khi team thống nhất.
