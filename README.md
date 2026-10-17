# Student Marketplace API

## Đồng bộ chat tăng dần

`GET /api/v1/conversations/:id/messages` nhận thêm `afterSequence` (chuỗi số nguyên thập phân không âm, tối đa bigint PostgreSQL). Backend kiểm tra quyền tham gia trước khi đọc lịch sử, rồi giới hạn `sequence > afterSequence`. Có thể kết hợp với cursor `before` hiện có để phân trang một khoảng tin mới; response vẫn mới → cũ, lấy `limit + 1`, trả `nextCursor` và `hasMore`. Không có migration DB mới; index `(conversation_id, sequence)` hiện có phục vụ khoảng sequence này.

Response REST gửi mới/đánh dấu đọc có thêm `conversation`, là snapshot của đúng người gọi đã được materialize trong transaction. Không đính snapshot của người gửi vào event room; history và replay giữ contract cũ, frontend dùng GET detail khi receipt không có snapshot. Snapshot hội thoại có thêm `post.thumbnailUrlExpiresAt` cho ảnh storage đã ký để frontend gia hạn ảnh mà không tải lại lịch sử.

Kiểm thử thuần: `npm test -- --runInBand message-history.spec.ts message-validation.spec.ts`. Kiểm thử SQL/transaction trong `test/integration/messages.spec.ts` cần DB test riêng theo phần cấu hình kiểm thử bên dưới.

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

### Bắt buộc hoàn tất vị trí

`GET /api/v1/user/me` trả thêm `hasLocation`, tính từ `user.location`. Principal cho REST/socket lấy lại vị trí từ DB mỗi lần xác thực, bỏ qua các cờ location trong JWT. Tài khoản thường thiếu vị trí nhận HTTP 403 với `code: LOCATION_REQUIRED` khi truy cập policy nghiệp vụ (post/chat/favorite/review/report/notification/upload), và không thể lấy socket ticket hoặc handshake bằng access JWT. Các API hồ sơ/vị trí, auth/refresh/đăng xuất, đổi/reset mật khẩu vẫn hoạt động để hoàn tất hoặc quản lý tài khoản. Admin được miễn kiểm tra vị trí; quyền CASL hiện có vẫn áp dụng.

Lưu bằng `PATCH /api/v1/user/me/location` làm các request tiếp theo với cùng JWT được chấp nhận; không cần đổi token hoặc migration. Tài khoản cũ chưa có vị trí cũng cần hoàn tất. `createReadyTestUser` trong fixture dành cho bài kiểm thử nghiệp vụ đã qua onboarding; `createTestUser` vẫn tạo tài khoản chưa có vị trí. Kiểm thử HTTP với DB test nằm trong `test/e2e/user-post-fields.spec.ts`.

### Xóa hội thoại riêng từng người

`DELETE /api/v1/conversations/:id` dành cho buyer/seller của hội thoại; trả snapshot với `deletedAt` của người gọi. Hội thoại được ẩn khỏi danh sách và tổng tin chưa đọc của người xóa. Thông báo tin nhắn của họ được đánh dấu đã đọc, nhưng messages/read watermark và lịch sử của người còn lại giữ nguyên. Gọi lặp khi vẫn đang ẩn không tăng version. Event `chat:conversation:updated` và `notification:changed` chỉ gửi tới các phiên của người xóa sau commit.

Tin nhắn **mới** khôi phục hội thoại cho cả hai; replay cùng `clientId` không khôi phục. Buyer mở lại từ bài đăng qua POST conversations sẽ khôi phục riêng phía buyer. Lịch sử cũ vẫn được giữ và có thể đọc qua API bởi participant; đây là soft delete khỏi hộp thư, không phải xóa nội dung.

Trước khi chạy backend mới trên DB có dữ liệu, áp dụng migration `1791800000000-ConversationParticipantDelete` bằng quy trình migration hiện có (`npm run migration:show`, `npm run migration:run`). Migration thêm hai cột nullable `buyer_deleted_at`/`seller_deleted_at`; rollback migration bỏ trạng thái ẩn đã lưu. Các kiểm thử PostgreSQL cho xóa/khôi phục/race nằm trong `test/integration/messages.spec.ts` và cần DB test riêng.

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
