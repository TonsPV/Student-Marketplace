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

Project dùng TypeORM với PostgreSQL driver `pg`. `POSTGRES_SYNCHRONIZE` mặc định là `false`; chỉ bật trên DB development/test trống. DB có dữ liệu được nâng schema bằng migration.

## University và tên địa điểm của post

- `university`: chuỗi tùy chọn, tối đa 150 ký tự; nhận ở `POST /api/v1/auth/register` và `PATCH /api/v1/user/me`, trả trong profile. Tài khoản Google mới có giá trị `NULL`.
- `locationName`: chuỗi tùy chọn, tối đa 255 ký tự; nhận ở `POST /api/v1/posts` và `PATCH /api/v1/posts/:id`, trả trong post. Tên địa điểm độc lập với tọa độ `location`.
- `location` của post nhận/trả `{ "latitude": 10.7769, "longitude": 106.7009 }`, cùng format với user. Latitude nằm trong [-90, 90], longitude trong [-180, 180]. PATCH bỏ qua field thì giữ vị trí cũ; gửi `null` để xóa. DB vẫn lưu `geography(Point, 4326)`, không cần migration. Payload GeoJSON cũ không còn được nhận. Query tìm kiếm theo khoảng cách vẫn dùng `lat`, `lng`, `radius`.
- Hai field được trim trước validation. Chuỗi rỗng/sai kiểu/quá dài bị từ chối. Khi tạo, bỏ field hoặc gửi `null` lưu `NULL`; khi PATCH, bỏ field giữ giá trị cũ và gửi `null` xóa giá trị.

Trước khi triển khai BE mới, cấu hình đúng DB và `POSTGRES_SCHEMA`, giữ `POSTGRES_SYNCHRONIZE=false`, rồi chạy:

```bash
npm run migration:show
npm run migration:run
```

Migration `1791730000000-UserUniversityPostLocationName` thêm `"user".university varchar(150) NULL` và `posts.location_name varchar(255) NULL`, giữ dữ liệu cũ. Nếu rollback ứng dụng sau khi đã ghi hai field mới, giữ hai cột DB. Migration revert từ chối xóa cột khi một trong hai còn dữ liệu khác `NULL`.

Kiểm thử migration/API dùng schema riêng tự tạo và tự dọn trong DB test, cấu hình bằng `TEST_POSTGRES_HOST`, `TEST_POSTGRES_PORT`, `TEST_POSTGRES_USER`, `TEST_POSTGRES_PASSWORD`, `TEST_POSTGRES_DB`:

```bash
npm run test:integration -- --runInBand user-post-fields-migration.spec.ts
npm run test:e2e -- --runInBand user-post-fields.spec.ts
```
