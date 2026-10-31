# Quota và vòng đời tin đăng — Nguyễn Việt Quang

## Quy tắc đã triển khai

| Nội dung          | Quy tắc                                                                  |
| ----------------- | ------------------------------------------------------------------------ |
| Quota mặc định    | 5 tin hiển thị đồng thời/người bán                                       |
| Một lượt hiển thị | 14 × 24 giờ, bắt đầu khi tạo/gia hạn thành công                          |
| Nhắc hạn          | Trong 3 ngày cuối, tối đa một thông báo/tin/chu kỳ                       |
| Hết hạn           | Một thông báo/tin/chu kỳ; tin ngừng xuất hiện công khai ngay khi hết hạn |
| Gia hạn miễn phí  | Một lần cho mỗi tin, chỉ khi đã hết hạn                                  |
| Gia hạn tiếp theo | Cần thanh toán; module thanh toán sẽ nối vào nghiệp vụ dùng chung        |
| Sửa/khôi phục     | Không đặt lại hạn, số lần gia hạn hoặc quyền miễn phí                    |
| Kiểm duyệt        | Chưa triển khai trong phạm vi này                                        |

Tin chiếm quota khi `status = active`, `deleted_at IS NULL` và `expires_at > thời điểm hiện tại`.
Tin đã bán, bị ẩn, đã xóa hoặc hết hạn không chiếm quota. Đẩy tin không tự tạo thêm suất hoặc kéo dài hạn.
Số 5, 14 và 3 được tập trung trong `post-lifecycle.constants.ts` (migration cố định theo phiên bản).

`createdAt` là ngày tạo ban đầu. `publishedAt` là thời điểm bắt đầu chu kỳ hiển thị hiện tại.
`expiresAt` là hạn của chu kỳ đó, `renewalCount = 0` lúc tạo và tăng mỗi lần gia hạn thành công.
`freeRenewalAvailable` cho biết lượt miễn phí chưa được sử dụng; đây là quyền lợi còn lại, không phải bảo đảm có thể gia hạn ngay (còn phụ thuộc trạng thái, quota, quyền đăng).
Các thời điểm trả về dưới dạng ISO UTC; FE định dạng theo múi giờ người dùng.

## Trạng thái và khôi phục

- Tạo tin: `active`, `publishedAt = hiện tại`, `expiresAt = publishedAt + 14 ngày`.
- Hết hạn: API riêng của chủ tin trả trạng thái hiệu lực `expired` ngay cả khi job chưa đổi trạng thái trong DB.
- Tab `active` cũng loại tin quá hạn; tab `expired` bao gồm tin đã chuyển trạng thái và tin `active` đã quá hạn.
- Khôi phục tin còn hạn: phải còn quota và không bị cấm đăng; giữ nguyên hạn cũ.
- Khôi phục tin quá hạn: khôi phục về `expired`, không chiếm quota; phải gia hạn để hiển thị lại.
- Khôi phục tin `sold`/`hidden`: giữ nguyên trạng thái; không kích hoạt lại.
- Gia hạn: chỉ nhận tin chưa xóa, chưa bán, không bị ẩn và đã hết hạn; bắt đầu chu kỳ mới 14 ngày từ thời điểm thành công.
- Được đánh dấu đã bán sau khi hết hạn để người bán cập nhật kết quả giao dịch; không kích hoạt lại tin.
- Tin đã bán vẫn truy cập được theo nghiệp vụ lịch sử hiện có, dù hạn hiển thị cũ đã qua. Home/search chỉ trả tin đang hiển thị.
- Hội thoại và lịch sử giao dịch đã tồn tại vẫn được giữ. Mở hội thoại/gửi tin theo `postId` mới phải qua điều kiện tin còn hiệu lực; gửi tiếp theo `conversationId` giữ hành vi hiện có.

## API cho FE

Prefix: `/api/v1`. Các response thành công được interceptor bọc trong `{ statusCode, message, data }`.
Các API riêng cần bearer token và vị trí tài khoản đã được thiết lập theo quy tắc hiện có.

| API                                       | Sử dụng                                                             |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `GET /posts/me/quota`                     | Quota trên form đăng/gia hạn                                        |
| `GET /posts/me?status=active`             | Tin đang hiển thị                                                   |
| `GET /posts/me?status=expired`            | Tab hết hạn, hỗ trợ `page`, `limit`, `categoryId`                   |
| `GET /posts/me?deleted=true`              | Tin đã xóa; vẫn hỗ trợ lọc trạng thái                               |
| `GET /posts/me/:id`                       | Chi tiết riêng của chủ tin, kể cả hết hạn/bị ẩn                     |
| `GET /posts/:id/images/me`                | Ảnh riêng của chủ tin, kể cả hết hạn                                |
| `POST /posts/:id/renew`                   | Gia hạn miễn phí lần đầu; không nhận dữ liệu thanh toán từ client   |
| `GET /posts/:id/renewals?page=1&limit=20` | Lịch sử gia hạn riêng của chủ tin, kể cả tin đã xóa                 |
| `PATCH /posts/:id/restore`                | Khôi phục với kiểm tra quota/quyền đăng khi cần                     |
| `PATCH /posts/:id/sold`                   | Đánh dấu đã bán như API hiện có; body `{ buyerId: UUID hoặc null }` |

Ví dụ `data` của API quota:

```json
{
  "maxLimit": 5,
  "limit": 5,
  "used": 4,
  "remaining": 1,
  "canActivate": true,
  "postingAllowed": true,
  "reason": null,
  "blockedUntil": null,
  "lifetimeDays": 14,
  "reminderDays": 3
}
```

Quota hiển thị trên FE chỉ là thông tin tại thời điểm đọc; server kiểm tra lại trong transaction khi ghi.
Sau tạo/xóa/khôi phục/gia hạn/đánh dấu đã bán, FE tải lại quota và danh sách liên quan.
Khi `expired`, hiển thị hạn cũ và nút gia hạn. Nếu `renewalCount = 0`, nút ghi “Gia hạn miễn phí”; các lần sau đi sang luồng thanh toán do nhóm trưởng cung cấp.
Không dùng endpoint công khai `/posts/:id` để mở trang quản lý tin hết hạn.

| HTTP / `code`               | Hành vi FE                                                              |
| --------------------------- | ----------------------------------------------------------------------- |
| 409 `POST_QUOTA_EXCEEDED`   | Báo đã đủ quota, tải lại quota; dùng `used`, `limit` trong lỗi          |
| 403 `POSTING_RESTRICTED`    | Hiển thị `reason`, `blockedUntil`; nối phần quản lý hạn chế của Tấn     |
| 403 `ACCOUNT_LOCKED`        | Xử lý khóa tài khoản riêng, không coi là cấm đăng theo uy tín           |
| 409 `POST_NOT_EXPIRED`      | Tin chưa hết hạn hoặc vừa được gia hạn ở tab khác; tải lại tin          |
| 409 `POST_PAYMENT_REQUIRED` | Lượt miễn phí đã dùng, chuyển sang thanh toán                           |
| 400 `POST_NOT_RENEWABLE`    | Tin đã bán/bị ẩn hoặc không còn đủ điều kiện                            |
| 404                         | Tin không còn tồn tại/đã xóa hoặc không thuộc endpoint truy cập phù hợp |

## Điểm tích hợp dành cho Tấn

`PostActivationPolicyService` là chỗ nối chính sách uy tín. Hiện chưa có dữ liệu/chính sách cấm đăng theo uy tín, nên mặc định không hạn chế và giới hạn là 5.
Khóa tài khoản hiện có vẫn được kiểm tra từ DB khi kích hoạt tin.

Tấn triển khai `PostingRestrictionPolicy` và đăng ký provider với token `POSTING_RESTRICTION_POLICY` trong phạm vi DI của `PostsModule`:

```ts
{
  provide: POSTING_RESTRICTION_POLICY,
  useExisting: ReputationPostingPolicy,
}
```

Nếu provider nằm trong module khác, export token rồi import module đó vào `PostsModule`.
Tránh tạo vòng phụ thuộc với `PostsService`; chính sách nên truy vấn dữ liệu uy tín qua `EntityManager` được truyền vào.

```ts
evaluate(manager, sellerId): Promise<{
  allowed: boolean;
  reason: string | null;
  blockedUntil: Date | null;
  limit: number; // số nguyên từ 0 đến 5
}>
```

- Hàm được gọi trong transaction sau khi đã khóa row người bán, trước khi đếm quota và kích hoạt.
- Chính sách tự xét thời điểm hết cấm; không phụ thuộc job gỡ cấm chạy đúng giờ.
- Khi cảnh báo nhưng vẫn cho đăng: trả `allowed: true`. Giao diện cảnh báo chi tiết vẫn do phần Tấn cung cấp.
- Khi cấm đăng: trả `allowed: false`, lý do và hạn cấm; không thay `isLocked`.
- Tạo/khôi phục tin còn hạn/gia hạn miễn phí/gia hạn trả phí đều qua chính sách này.
- Khôi phục tin hết hạn chỉ đưa lại vào quản lý, không hiển thị nên không cần vượt qua chính sách kích hoạt.
- Các thao tác cấm/gỡ cấm/thay quota cần khóa cùng row `user` bằng `FOR UPDATE` trong transaction. Thứ tự khóa thống nhất: **người bán → tin**. Nhờ đó tránh kích hoạt song song dựa trên chính sách cũ.
- Chưa tự ẩn tin đang hiển thị khi bị cấm đăng; Tấn quyết định và triển khai hành vi đó nếu nhóm chọn.

`visiblePostSql(alias)` là điều kiện dùng chung cho feed/search/đẩy tin. Tấn giữ điều kiện này **trước** `COUNT`, sắp xếp và phân trang khi tích hợp uy tín + đẩy tin.
`publicPostSql(alias)` cho các nơi cần giữ cả lịch sử tin đã bán.
`sellerStatistics.activeCount` đã loại tin quá hạn ngay khi đọc.

## Điểm tích hợp thanh toán

Export `PostLifecycleService` từ `PostsModule`.
Module thanh toán xác thực thanh toán thuộc đúng người bán, đúng tin/sản phẩm gia hạn, đủ tiền và thành công, sau đó gọi:

```ts
await dataSource.transaction("READ COMMITTED", async (manager) => {
  // Kiểm tra/khóa payment bằng manager; không gọi cổng thanh toán khi đang giữ khóa.
  await lifecycle.renewPaidWithManager(
    manager,
    postId,
    sellerContext,
    paymentReference,
  );
  // Ghi nhận payment đã được sử dụng trong cùng transaction.
});
```

`sellerContext` phải được tạo bằng `AuthorizationService` từ thông tin người bán do server xác thực, không nhận context/role từ webhook/client.
Nếu cần khóa row người bán ở module thanh toán, vẫn tuân theo thứ tự người bán → tin và giữ thứ tự khóa payment nhất quán giữa các đường xử lý.

- Chỉ cho trả phí sau khi đã dùng lượt miễn phí.
- Gia hạn trả phí yêu cầu transaction `READ COMMITTED` (được kiểm tra trong service), để đếm quota bằng snapshot mới sau khi chờ khóa người bán.
- Vẫn kiểm tra hạn, trạng thái, quota và quyền đăng; không cập nhật `expiresAt` riêng trong module thanh toán.
- `paymentReference` là mã ổn định của lần thanh toán, tối đa 150 ký tự, duy nhất toàn hệ thống.
- Một mã đã dùng cho đúng tin được trả lại mà không gia hạn lần nữa; dùng cho tin khác bị từ chối. Unique index bảo vệ cả các yêu cầu chạy đồng thời.
- Gia hạn và lịch sử rollback cùng transaction nếu ghi nhận thanh toán thất bại.
- Nếu đã thu tiền nhưng lúc kích hoạt bị hết quota/cấm đăng, module thanh toán phải giữ quyền gia hạn chưa sử dụng hoặc xử lý hoàn tiền theo chính sách nhóm trưởng. Không được coi là đã hoàn tất kích hoạt.
- Chưa có endpoint công khai cho gia hạn trả phí; client không thể gửi một chuỗi `paymentReference` để tự gia hạn.

## Thông báo dùng chung

Thêm `post_expiring`, `post_expired`. `NotificationsService.createOnce(manager, input)` ghi thông báo trong transaction nghiệp vụ bằng `dedupKey` duy nhất.
`emitCreated(entity)` gọi sau commit. Lỗi socket không làm thất bại nghiệp vụ; danh sách và unread count REST là nguồn dữ liệu chính.

DTO thông báo thêm:

```json
{ "target": { "type": "my_post", "id": "UUID của tin" } }
```

FE ánh xạ `my_post` sang trang quản lý tin riêng. `conversation` mở hội thoại; `purchase` mở giao dịch cần đánh giá.
Để Tấn/nhóm trưởng mở rộng, `target_type` còn hỗ trợ `posting_status`, `payment`; cần thêm loại thông báo và migration enum tương ứng khi triển khai.

Sự kiện `notification:changed` cho một thông báo ngoài chat có `{ type, refId }`.
Đánh dấu tất cả đã đọc phát `{ scope: "non_message", refId: null }` cho nhóm ngoài chat; FE tải lại list/count, không coi `refId` của tin là conversation ID.
Các snapshot/version/watermark của chat giữ luồng hiện có.

Job chạy mỗi phút, mỗi batch tối đa 100 tin, có khóa `SKIP LOCKED` và unique `dedup_key` để nhiều instance không gửi trùng.
Nếu job dừng, tin quá hạn vẫn bị loại tại truy vấn; khi chạy lại, job xử lý thông báo hết hạn còn thiếu.
Job ngừng lâu qua toàn bộ khoảng nhắc thì chỉ gửi hết hạn, không gửi cảnh báo đã lỗi thời.
Đọc thông báo không xóa dấu chống trùng; gia hạn tăng số chu kỳ nên được nhận thông báo cho chu kỳ mới.

## Migration và dữ liệu cũ

Migration: `1791810000000-PostLifecycle.ts`. Chạy trước khi chạy phiên bản backend mới trên database đã có dữ liệu:

```powershell
npm.cmd run migration:run
```

Migration cấp chu kỳ 14 ngày từ thời điểm áp dụng, giữ `created_at`, trạng thái, dấu xóa và dữ liệu giao dịch cũ.
Không tự bật lại tin đã bán/ẩn/xóa. Các tài khoản cũ đang có hơn 5 tin được giữ dữ liệu; không thể kích hoạt thêm cho đến khi số tin hiển thị thấp hơn quota.
Migration cũng mở rộng constraint giao dịch cho trạng thái `expired`, tạo bảng lịch sử/index và cột thông báo.
Rollback xóa dữ liệu gia hạn/thông báo vòng đời và đưa `expired` về `active` theo hành vi phiên bản cũ; nhãn enum PostgreSQL được giữ lại.

## Kiểm thử

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm.cmd run build
npm.cmd test -- --runInBand
# Dùng TEST_POSTGRES_* theo test/integration/database.ts để chọn database kiểm thử.
npm.cmd run test:integration -- --runInBand post-lifecycle
```

Các integration test tạo schema ngẫu nhiên riêng, chỉ dọn schema do test sở hữu. Bao gồm tranh suất giữa tạo/khôi phục/gia hạn, thời hạn khi job dừng, miễn phí một lần, thanh toán lặp/rollback, worker đồng thời và migration dữ liệu cũ.
FE trong repo `student-marketplace-nextjs` đã tích hợp hạn mức trên form đăng/hồ sơ, tab “Hết hạn”, nút gia hạn miễn phí, lịch sử và điều hướng thông báo. Trang `/my-posts/:id` dùng API riêng để chủ tin xem tin hết hạn; sau đăng nhập vẫn quay về đúng trang này. Gia hạn trả phí hiện chưa khả dụng trên giao diện, chờ module thanh toán của nhóm trưởng.
