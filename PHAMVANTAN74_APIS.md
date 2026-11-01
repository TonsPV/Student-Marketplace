# Danh Sách API Do PhamVanTan74 Triển Khai
> **Dự án:** Student Marketplace (Sàn giao dịch sinh viên)  
> **Tác giả commit:** PhamVanTan74 (`TonsPV` - `tanphanchan@gmail.com`)  
> **Tiền tố API toàn cục (Global Prefix):** `/api/v1`  
> **Cơ chế xác thực:** Bearer Token (JWT) trong header `Authorization: Bearer <access-token>`

---

## 📌 Bảng Tổng Hợp Nhanh Các API

| STT | Module | Method | Endpoint | Quyền truy cập | Tóm tắt chức năng |
|:---:|:---|:---:|:---|:---|:---|
| **1** | **Posts** | `POST` | `/api/v1/posts` | User đăng nhập | Đăng bài viết / sản phẩm mới |
| **2** | **Posts** | `GET` | `/api/v1/posts` | Public | Danh sách bài đăng công khai (phân trang, lọc) |
| **3** | **Posts** | `GET` | `/api/v1/posts/me` | User đăng nhập | Danh sách bài đăng của chính tôi |
| **4** | **Posts** | `GET` | `/api/v1/posts/:id` | Public / Context | Xem chi tiết bài viết |
| **5** | **Posts** | `PATCH` | `/api/v1/posts/:id` | Chủ bài viết / Admin | Chỉnh sửa thông tin bài viết |
| **6** | **Posts** | `DELETE` | `/api/v1/posts/:id` | Chủ bài viết / Admin | Xóa bài viết (xóa mềm - Soft delete) |
| **7** | **Posts** | `PATCH` | `/api/v1/posts/:id/restore` | Chủ bài viết / Admin | Khôi phục bài viết đã xóa mềm |
| **8** | **Posts** | `PATCH` | `/api/v1/posts/:id/sold` | Chủ bài viết (Người bán) | Xác nhận bán sản phẩm cho người mua (Đã bán) |
| **9** | **Posts** | `GET` | `/api/v1/posts/:id/buyers` | Chủ bài viết (Người bán) | Lấy danh sách người mua tiềm năng đã nhắn tin |
| **10** | **Posts** | `GET` | `/api/v1/posts/purchased` | User đăng nhập (Người mua) | Danh sách sản phẩm tôi đã mua & trạng thái đánh giá |
| **11** | **Post Images** | `POST` | `/api/v1/posts/:postId/images` | Chủ bài viết | Thêm hình ảnh vào bài đăng |
| **12** | **Post Images** | `GET` | `/api/v1/posts/:postId/images` | Public | Lấy danh sách ảnh của bài đăng |
| **13** | **Post Images** | `DELETE` | `/api/v1/posts/:postId/images/:imageId` | Chủ bài viết | Xóa hình ảnh của bài đăng |
| **14** | **Reports** | `POST` | `/api/v1/reports` | User đăng nhập | Gửi báo cáo vi phạm bài viết hoặc người dùng |
| **15** | **Reports** | `GET` | `/api/v1/admin/reports` | Admin | Lấy danh sách báo cáo vi phạm (phân trang, lọc) |
| **16** | **Reports** | `GET` | `/api/v1/admin/reports/:id` | Admin | Xem chi tiết một báo cáo vi phạm |
| **17** | **Reports** | `PATCH` | `/api/v1/admin/reports/:id/action` | Admin | Xử lý báo cáo (Bác bỏ / Ẩn bài / Khóa user) |
| **18** | **Reviews** | `POST` | `/api/v1/reviews` | Người mua xác nhận | Tạo đánh giá người bán sau khi giao dịch hoàn tất |
| **19** | **Reviews** | `GET` | `/api/v1/reviews/:id` | Public | Xem chi tiết một đánh giá |
| **20** | **Reviews** | `GET` | `/api/v1/posts/:postId/reviews` | Public | Xem danh sách đánh giá của bài đăng |
| **21** | **Reviews** | `GET` | `/api/v1/users/:sellerId/reviews` | Public | Xem danh sách đánh giá uy tín của người bán |
| **22** | **Reviews** | `PATCH` | `/api/v1/reviews/:id` | Người viết đánh giá | Chỉnh sửa nội dung / số sao đánh giá |
| **23** | **Reviews** | `DELETE` | `/api/v1/reviews/:id` | Người viết / Admin | Xóa mềm đánh giá |
| **24** | **Conversations** | `POST` | `/api/v1/conversations` | User đăng nhập (Người mua) | Khởi tạo hoặc lấy cuộc trò chuyện theo bài đăng |
| **25** | **Conversations** | `GET` | `/api/v1/conversations` | User đăng nhập | Danh sách các cuộc trò chuyện của tôi |
| **26** | **Conversations** | `GET` | `/api/v1/conversations/:id` | Người tham gia chat | Lấy chi tiết cuộc trò chuyện |

---

## 1. 📦 Module Posts (Quản lý Bài đăng & Giao dịch)

Module bài đăng do `PhamVanTan74` xây dựng từ nền tảng CRUD, quản lý trạng thái bài đăng, cho đến mở rộng logic chốt giao dịch (`markAsSold`), kiểm soát người mua (`buyer candidates`) và tra cứu đơn đã mua (`findPurchased`).

### 1.1. Tạo bài viết mới
- **Endpoint:** `POST /api/v1/posts`
- **Mô tả:** Đăng bán một món hàng / sản phẩm mới lên sàn.
- **Xác thực:** Yêu cầu đăng nhập (`Bearer Token`).
- **Request Body (`CreatePostDto`):**
  ```json
  {
    "categoryId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "title": "Giáo trình Giải tích 1 ĐHBK",
    "description": "Sách còn mới 95%, không rách, có ghi chú bằng bút chì.",
    "price": 45000,
    "condition": "LIKE_NEW",
    "location": {
      "latitude": 10.776889,
      "longitude": 106.657806
    },
    "locationName": "Ký túc xá khu A, ĐHQG"
  }
  ```
- **Nghiệp vụ & Ràng buộc:**
  - Kiểm tra `categoryId` có tồn tại trong hệ thống.
  - Tự động gán `sellerId = currentUser.id`.
  - Tọa độ `location` được lưu trữ dưới dạng GeoJSON Point phục vụ tìm kiếm theo bán kính.
  - Trạng thái khởi tạo mặc định là `ACTIVE`.

---

### 1.2. Lấy danh sách bài viết công khai
- **Endpoint:** `GET /api/v1/posts`
- **Mô tả:** Lấy danh sách bài viết đang mở bán trên sàn giao dịch dành cho người mua tham khảo.
- **Xác thực:** Công khai (Public).
- **Query Parameters (`FindPostsDto`):**
  - `page`: Số trang (mặc định: `1`).
  - `limit`: Số lượng mỗi trang (mặc định: `10`).
  - `categoryId`: Lọc theo danh mục sản phẩm (UUID).
  - `condition`: Lọc theo tình trạng (`NEW`, `LIKE_NEW`, `USED_GOOD`, `USED_FAIR`).
  - `minPrice`, `maxPrice`: Lọc theo khoảng giá.
  - `sortBy`: Trường sắp xếp (`createdAt`, `price`).
  - `sortOrder`: Thứ tự sắp xếp (`ASC`, `DESC`).
- **Nghiệp vụ:** Chỉ hiển thị những bài viết có trạng thái `ACTIVE` và chưa bị xóa mềm (`deletedAt IS NULL`). Trả kèm metadata phân trang chuẩn (`page`, `limit`, `total`, `totalPages`).

---

### 1.3. Lấy danh sách bài viết của tôi (My Posts)
- **Endpoint:** `GET /api/v1/posts/me`
- **Mô tả:** Người bán xem toàn bộ các sản phẩm do mình đăng bán để quản lý.
- **Xác thực:** Yêu cầu đăng nhập (`Bearer Token`).
- **Query Parameters (`FindMyPostsDto`):**
  - `page`, `limit`: Phân trang.
  - `status`: Lọc theo trạng thái bài viết (`ACTIVE`, `SOLD`, `HIDDEN`).
- **Nghiệp vụ:** Trả về tất cả bài viết có `sellerId = currentUser.id`, bao gồm cả bài đang ẩn hoặc đã bán.

---

### 1.4. Lấy chi tiết bài viết
- **Endpoint:** `GET /api/v1/posts/:id`
- **Mô tả:** Xem đầy đủ thông tin một bài đăng cụ thể.
- **Xác thực:** Public (Nếu bài bị ẩn, chỉ chính chủ hoặc Admin mới có quyền xem).
- **Path Parameter:** `id` (UUIDv7 của bài viết).
- **Dữ liệu trả về:** Thông tin bài đăng, danh mục (`category`), người bán (`seller` gồm id, tên, avatar), danh sách ảnh (`images`).

---

### 1.5. Chỉnh sửa bài viết
- **Endpoint:** `PATCH /api/v1/posts/:id`
- **Mô tả:** Cập nhật tiêu đề, mô tả, giá cả, tình trạng hoặc vị trí sản phẩm.
- **Xác thực:** Yêu cầu đăng nhập (Chính chủ người bán hoặc Admin).
- **Path Parameter:** `id` (UUIDv7).
- **Request Body (`UpdatePostDto`):** Các trường tùy chọn tương tự `CreatePostDto`.
- **Ràng buộc:** Chặn sửa đổi nếu bài viết đang bị Admin khóa/ẩn do vi phạm (`HIDDEN`).

---

### 1.6. Xóa bài viết (Soft Delete)
- **Endpoint:** `DELETE /api/v1/posts/:id`
- **Mô tả:** Người bán gỡ bài viết hoặc Admin xóa bài vi phạm.
- **Xác thực:** Yêu cầu đăng nhập (Chính chủ hoặc Admin).
- **Nghiệp vụ:** Sử dụng cơ chế xóa mềm (`softDelete`, cập nhật `deletedAt = now()`), không xóa vĩnh viễn khỏi database để đảm bảo tính toàn vẹn dữ liệu cho các báo cáo và hóa đơn trước đó.

---

### 1.7. Khôi phục bài viết đã xóa
- **Endpoint:** `PATCH /api/v1/posts/:id/restore`
- **Mô tả:** Khôi phục bài đăng đã xóa mềm trước đó về lại trạng thái hoạt động.
- **Xác thực:** Yêu cầu đăng nhập (Chính chủ hoặc Admin).
- **Nghiệp vụ:** Đặt lại `deletedAt = null`.

---

### 1.8. Xác nhận giao dịch / Đánh dấu đã bán
- **Endpoint:** `PATCH /api/v1/posts/:id/sold`
- **Mô tả:** Người bán đánh dấu sản phẩm đã giao dịch thành công cho một người mua cụ thể.
- **Xác thực:** Yêu cầu đăng nhập (Chính chủ người bán sở hữu bài viết).
- **Path Parameter:** `id` (UUIDv7 của bài viết).
- **Request Body (`MarkPostSoldDto`):**
  ```json
  {
    "buyerId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
  ```
- **Nghiệp vụ & Bất biến giao dịch (Invariants):**
  1. Bài viết bị `HIDDEN` không được phép đánh dấu đã bán.
  2. Không được bán cho chính mình (`buyerId !== post.sellerId`).
  3. **Kiểm tra người mua hợp lệ:** Người mua (`buyerId`) **bắt buộc phải là người đã từng trò chuyện và gửi tin nhắn** hỏi mua bài viết này trong hệ thống.
  4. Cập nhật `post.status = SOLD`, `post.buyerId = buyerId`, `post.soldAt = now()`.
  5. **Tự động gửi thông báo:** Tạo bản ghi thông báo trong DB (`NotificationType.REVIEW_REQUEST`) gửi đến người mua với nội dung mời đánh giá trong 30 ngày, đồng thời bắn sự kiện Realtime WebSocket `NOTIFICATION_NEW`.
  6. **Tính Idempotent:** Nếu bài đã bán cho đúng `buyerId` đó trước đó, trả về thành công thay vì báo lỗi.

---

### 1.9. Lấy danh sách người mua tiềm năng
- **Endpoint:** `GET /api/v1/posts/:id/buyers`
- **Mô tả:** Lấy danh sách những người dùng đã nhắn tin liên hệ về bài đăng này để người bán chọn xác nhận khi bấm "Đã bán".
- **Xác thực:** Yêu cầu đăng nhập (Chính chủ người bán).
- **Dữ liệu trả về:** Danh sách ứng viên gồm `id`, `fullName`, `avatarUrl`.

---

### 1.10. Lấy danh sách sản phẩm đã mua
- **Endpoint:** `GET /api/v1/posts/purchased`
- **Mô tả:** Người mua xem lại lịch sử các món hàng mình đã mua thành công và kiểm tra tình trạng đánh giá.
- **Xác thực:** Yêu cầu đăng nhập (Buyer).
- **Query Parameters (`FindPostsDto`):** `page`, `limit`.
- **Dữ liệu trả về chi tiết:**
  - Danh sách bài viết có `buyerId = currentUser.id` và `status = SOLD`.
  - Thông tin người bán kèm avatar đầy đủ (`avatarStorageKey` được resolve ra URL).
  - `soldAt`: Thời điểm hoàn tất giao dịch.
  - `reviewDeadline`: Hạn chót được phép đánh giá (`soldAt + 30 ngày`).
  - `canReview`: `true` nếu còn trong hạn 30 ngày và chưa đánh giá.
  - `reviewStatus`: Trạng thái đánh giá gồm `REVIEWED` (đã đánh giá), `NOT_REVIEWED` (chưa đánh giá và còn hạn), `EXPIRED` (đã quá hạn 30 ngày).
  - `review`: Chi tiết đánh giá đã gửi (nếu có, kể cả khi review bị xóa mềm vẫn được ghi nhận).

---

## 2. 🖼️ Module Post Images (Quản lý Hình ảnh Sản phẩm)

Module quản lý các ảnh minh họa đính kèm của bài đăng, do `PhamVanTan74` triển khai tại commit `e48fdd1`.

### 2.1. Thêm ảnh cho bài đăng
- **Endpoint:** `POST /api/v1/posts/:postId/images`
- **Mô tả:** Thêm một URL hình ảnh vào danh sách ảnh của bài viết.
- **Xác thực:** Yêu cầu đăng nhập (Chủ bài viết).
- **Request Body (`CreatePostImageDto`):**
  ```json
  {
    "imageUrl": "https://pub-r2.example.com/posts/image-123.jpg"
  }
  ```
- **Nghiệp vụ:** Kiểm tra quyền sở hữu bài viết và lưu ảnh kèm `displayOrder`.

### 2.2. Lấy danh sách ảnh của bài đăng
- **Endpoint:** `GET /api/v1/posts/:postId/images`
- **Mô tả:** Lấy toàn bộ ảnh thuộc về một bài đăng.
- **Xác thực:** Công khai (Public).

### 2.3. Xóa ảnh khỏi bài đăng
- **Endpoint:** `DELETE /api/v1/posts/:postId/images/:imageId`
- **Mô tả:** Xóa một ảnh cụ thể của bài viết.
- **Xác thực:** Yêu cầu đăng nhập (Chủ bài viết).

---

## 3. 🛡️ Module Reports (Báo cáo Vi phạm & Kiểm duyệt)

Triển khai tại commit `0a59d4b` nhằm giải quyết việc kiểm duyệt nội dung, bảo vệ người dùng sinh viên khỏi lừa đảo, hàng cấm hoặc quấy rối.

### 3.1. Gửi báo cáo vi phạm
- **Endpoint:** `POST /api/v1/reports`
- **Mô tả:** Người dùng báo cáo một bài viết hoặc một tài khoản người dùng có hành vi gian lận / vi phạm tiêu chuẩn cộng đồng.
- **Xác thực:** Yêu cầu đăng nhập (Bất kỳ user nào đang hoạt động).
- **Request Body (`CreateReportDto`):**
  ```json
  {
    "targetType": "POST", // hoặc "USER"
    "targetId": "e3b0c442-98fc-1c14-9afbf4c8996fb924",
    "reason": "SCAM",
    "description": "Người này yêu cầu chuyển cọc trước nhưng sau đó chặn liên lạc.",
    "evidenceUrls": [
      "https://example.com/evidence1.jpg",
      "https://example.com/evidence2.jpg"
    ]
  }
  ```
  - `reason` gồm: `SPAM`, `PROHIBITED_ITEMS`, `SCAM`, `HARASSMENT`, `INAPPROPRIATE_CONTENT`, `OTHER`.
- **Ràng buộc:**
  - Không được tự báo cáo chính mình hoặc tự báo cáo bài đăng của chính mình.
  - Mỗi người dùng chỉ được có tối đa 1 báo cáo ở trạng thái `PENDING` cho cùng một đối tượng mục tiêu.

---

### 3.2. Danh sách báo cáo vi phạm (Dành cho Admin)
- **Endpoint:** `GET /api/v1/admin/reports`
- **Mô tả:** Admin xem danh sách các báo cáo đang chờ xử lý hoặc đã giải quyết.
- **Xác thực:** Yêu cầu quyền **Admin**.
- **Query Parameters (`FilterReportDto`):**
  - `page`, `limit`: Phân trang.
  - `status`: Lọc theo trạng thái `PENDING`, `RESOLVED`, `DISMISSED`.
- **Dữ liệu trả về:** Danh sách báo cáo kèm thông tin người gửi đơn (`reporter`: tên, email, avatar).

---

### 3.3. Xem chi tiết báo cáo vi phạm (Dành cho Admin)
- **Endpoint:** `GET /api/v1/admin/reports/:id`
- **Mô tả:** Admin xem chi tiết nội dung khiếu nại, bằng chứng và thông tin đối tượng bị báo cáo.
- **Xác thực:** Yêu cầu quyền **Admin**.
- **Dữ liệu trả về:** Chi tiết báo cáo, thông tin người báo cáo, người xử lý trước đó (`resolvedBy`), và dữ liệu thực tế của mục tiêu (`target`: thông tin bài viết nếu `targetType = POST` hoặc thông tin user nếu `targetType = USER`).

---

### 3.4. Xử lý báo cáo vi phạm (Dành cho Admin)
- **Endpoint:** `PATCH /api/v1/admin/reports/:id/action`
- **Mô tả:** Admin thực hiện quyết định kỷ luật hoặc bác bỏ báo cáo.
- **Xác thực:** Yêu cầu quyền **Admin**.
- **Path Parameter:** `id` (UUIDv7 của báo cáo).
- **Request Body (`HandleReportDto`):**
  ```json
  {
    "action": "RESOLVE_HIDE_POST",
    "adminNote": "Xác nhận bài viết bán tài liệu cấm, tiến hành ẩn bài."
  }
  ```
- **Các hành động (`action`):**
  1. `DISMISS`: Bác bỏ báo cáo vì không có cơ sở -> Chuyển trạng thái báo cáo sang `DISMISSED`.
  2. `RESOLVE_HIDE_POST`: Áp dụng cho báo cáo bài viết. Tự động chuyển bài viết sang `PostStatus.HIDDEN` và đánh dấu `RESOLVED` toàn bộ các đơn báo cáo đang `PENDING` liên quan đến bài này.
  3. `RESOLVE_BAN_USER`: Áp dụng cho báo cáo tài khoản. Khóa tài khoản người dùng (`isLocked = true`), thu hồi toàn bộ token đăng nhập và phiên WebSocket, chuyển trạng thái báo cáo sang `RESOLVED`. Không cho phép Admin tự khóa tài khoản của chính mình.
- **Cơ chế an toàn (Concurrency Safety):** Sử dụng PostgreSQL advisory xact lock (`pg_advisory_xact_lock`) kết hợp `pessimistic_write` lock nhằm chống xung đột dữ liệu khi nhiều Admin cùng xử lý 1 báo cáo tại một thời điểm.

---

## 4. ⭐ Module Reviews (Đánh giá & Xếp hạng Người bán)

Module do `PhamVanTan74` triển khai tại commit `a55884b` và hoàn thiện ở các commit `4d31d38`, `23294bf`. Đảm bảo đánh giá khách quan, uy tín và hạn chế tối đa việc đánh giá ảo/gian lận.

### 4.1. Tạo đánh giá sau giao dịch
- **Endpoint:** `POST /api/v1/reviews`
- **Mô tả:** Người mua đánh giá chất lượng sản phẩm và mức độ uy tín của người bán sau khi nhận hàng.
- **Xác thực:** Yêu cầu đăng nhập (`Bearer Token`).
- **Request Body (`CreateReviewDto`):**
  ```json
  {
    "postId": "550e8400-e29b-41d4-a716-446655440000",
    "rating": 5,
    "comment": "Người bán nhiệt tình, sách mới đúng như mô tả, giao dịch nhanh chóng!"
  }
  ```
  - `rating`: Số nguyên từ `1` đến `5` sao.
  - `comment`: Tùy chọn, tối đa 5000 ký tự.
- **Ràng buộc chặt chẽ:**
  1. Bài viết phải ở trạng thái `SOLD`.
  2. **Chỉ người mua được xác nhận (`post.buyerId === currentUser.id`) mới có quyền đánh giá.**
  3. Người bán không thể tự đánh giá bài đăng của chính mình.
  4. **Thời hạn 30 ngày:** Bắt buộc gửi đánh giá trong vòng 30 ngày kể từ lúc người bán xác nhận bán (`soldAt`). Nếu quá hạn sẽ bị từ chối (`403 Forbidden`).
  5. **Mỗi giao dịch chỉ đánh giá 1 lần:** Unique constraint trên database (`uq_reviews_post_id`, `uq_reviews_reviewer_post`). Nếu cố tình gửi lại sẽ trả về lỗi `409 Conflict`.

---

### 4.2. Xem chi tiết đánh giá
- **Endpoint:** `GET /api/v1/reviews/:id`
- **Mô tả:** Xem chi tiết một bài đánh giá theo ID.
- **Xác thực:** Công khai (Public).

---

### 4.3. Xem danh sách đánh giá của một bài đăng
- **Endpoint:** `GET /api/v1/posts/:postId/reviews`
- **Mô tả:** Xem phản hồi của người mua về món hàng này.
- **Xác thực:** Công khai (Public).
- **Query Parameters:** `page`, `limit`.

---

### 4.4. Xem danh sách đánh giá của người bán (Seller Reviews)
- **Endpoint:** `GET /api/v1/users/:sellerId/reviews`
- **Mô tả:** Lấy toàn bộ đánh giá từ các bài viết mà người bán này đã bán thành công. Dùng để tính toán số sao trung bình và hiển thị độ uy tín của seller trên trang hồ sơ cá nhân.
- **Xác thực:** Công khai (Public).
- **Query Parameters:** `page`, `limit`.

---

### 4.5. Chỉnh sửa đánh giá
- **Endpoint:** `PATCH /api/v1/reviews/:id`
- **Mô tả:** Người mua cập nhật lại số sao hoặc lời nhận xét của mình.
- **Xác thực:** Yêu cầu đăng nhập (Chính chủ người đã viết đánh giá `reviewerId`).
- **Request Body (`UpdateReviewDto`):** `rating` (1-5), `comment`.

---

### 4.6. Xóa đánh giá (Soft Delete)
- **Endpoint:** `DELETE /api/v1/reviews/:id`
- **Mô tả:** Người viết xóa đánh giá hoặc Admin xóa đánh giá vi phạm thuần phong mỹ tục.
- **Xác thực:** Yêu cầu đăng nhập (Người viết hoặc Admin).
- **Nghiệp vụ:** Sử dụng xóa mềm (`softRemove`). Bài đăng vẫn được lưu dấu đã từng được đánh giá (không cho phép người mua tạo lại đánh giá khác cho cùng bài viết đó).

---

## 5. 💬 Module Conversations (Hội thoại Ban đầu)

Triển khai tại commit `32f81e1` & `d03c01a`. Tạo tiền đề cho luồng chat kết nối trực tiếp giữa người mua và người bán theo từng bài đăng sản phẩm.

### 5.1. Khởi tạo / Lấy cuộc trò chuyện theo bài đăng
- **Endpoint:** `POST /api/v1/conversations`
- **Mô tả:** Người mua bấm nút "Nhắn tin cho người bán" trên trang chi tiết sản phẩm.
- **Xác thực:** Yêu cầu đăng nhập.
- **Request Body (`CreateConversationDto`):**
  ```json
  {
    "postId": "550e8400-e29b-41d4-a716-446655440000"
  }
  ```
- **Nghiệp vụ:**
  - Chặn người dùng tự tạo cuộc trò chuyện với chính bài đăng của mình.
  - Tự động kiểm tra: Nếu cuộc trò chuyện giữa người mua này và người bán của bài viết đã tồn tại thì trả về cuộc hội thoại cũ, nếu chưa có thì khởi tạo mới.

---

### 5.2. Danh sách cuộc trò chuyện của tôi
- **Endpoint:** `GET /api/v1/conversations`
- **Mô tả:** Lấy danh sách hộp thư đến (inbox) của người dùng hiện tại (cả vai trò người mua lẫn người bán).
- **Xác thực:** Yêu cầu đăng nhập.
- **Query Parameters:** `page`, `limit`.
- **Dữ liệu trả về:** Danh sách hội thoại kèm thông tin đối phương, bài đăng đính kèm và tin nhắn mới nhất.

---

### 5.3. Xem chi tiết cuộc trò chuyện
- **Endpoint:** `GET /api/v1/conversations/:id`
- **Mô tả:** Lấy thông tin chi tiết một phòng chat.
- **Xác thực:** Yêu cầu đăng nhập (Phải là một trong hai người tham gia phòng chat: `buyerId` hoặc `sellerId`).

*(Ghi chú: Luồng gửi tin nhắn chi tiết `POST /conversations/:id/messages` và nhận tin thời gian thực sau này được cộng sự Nekko tách và phát triển mở rộng thành module `messages` với WebSocket và Cloudflare R2).*

---

## 6. ⚙️ Đóng Góp Nền Tảng & Hạ Tầng Kỹ Thuật

Bên cạnh các API nghiệp vụ cụ thể, `PhamVanTan74` đóng góp vai trò kiến trúc cốt lõi cho dự án:

1. **Khởi tạo dự án & Kết nối Cơ sở dữ liệu:**
   - Cấu hình môi trường (`Dockerfile`, `compose.yml`, `package.json`, TypeScript build).
   - Tích hợp TypeORM với PostgreSQL.
   - Xây dựng cơ chế validate biến môi trường tùy chỉnh (`src/config/environment.validation.ts`).
2. **Bộ chuẩn hóa Phân trang Toàn cục (Standardized Pagination):**
   - Viết class `PaginationDto` (`src/common/dto/pagination.dto.ts`) và hàm tiện ích `createPaginationMeta` (`src/common/utils/pagination.util.ts`), giúp toàn bộ các API trong hệ thống có cấu trúc phân trang đồng nhất:
     ```json
     {
       "items": [...],
       "meta": {
         "page": 1,
         "limit": 10,
         "total": 42,
         "totalPages": 5,
         "hasPreviousPage": false,
         "hasNextPage": true
       }
     }
     ```
3. **Thiết kế Database Migrations Chặt Chẽ:**
   - Xây dựng các file migration cho luồng chốt đơn và đánh giá (`1791760000000-PostBuyerSoldAt.ts`, `1791770000000-ReviewRequestNotification.ts`, `1791780000000-PostTimestampAndReviewInvariant.ts`, `1791790000000-PostTransactionInvariant.ts`).
   - Thiết lập các ràng buộc Foreign Key, Unique Indexes và Transaction Locks đảm bảo an toàn dữ liệu mức cơ sở dữ liệu.
