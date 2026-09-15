# Hướng dẫn phát triển backend

## Thư mục chính

| Đường dẫn | Công dụng |
| --- | --- |
| `src/modules/` | Nghiệp vụ, hiện có `auth`, `user`, `refresh-tokens`. |
| `src/common/` | Base entity, guard, decorator và interceptor dùng chung. |
| `src/shared/interfaces/` | Interface dùng chung giữa các module. |
| `src/config/` | Cấu hình ứng dụng, hiện có Helmet. |
| `src/database/seeds/` | Seed admin tự chạy khi khởi động. |
| `src/app.module.ts` | Kết nối DB và ghép các module. |
| `src/main.ts` | Khởi động, JWT guard, validation, Swagger và version API. |
| `scripts/` | Các kiểm thử regression chạy riêng. |

Module mới đặt trong `src/modules/<ten-module>/`, gồm `.module.ts`, `.entity.ts`, `.service.ts`, `.controller.ts` và thư mục `dto/`. Dùng relative import cho code nội bộ; không dùng `src/...`.

## 1. Entity: cấu trúc dữ liệu DB

Kế thừa `BaseEntity` của project, không phải `BaseEntity` từ TypeORM. Base đã có ID UUIDv7 và hook sinh ID; chưa có timestamp hoặc soft-delete.

Ví dụ `src/modules/product/product.entity.ts`:

```ts
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('products')
export class ProductEntity extends BaseEntity {
  @Column({ name: 'display_name' })
  displayName!: string;

  @Column({ type: 'varchar', nullable: true })
  description!: string | null;
}
```

- Property TypeScript dùng camelCase, tên cột DB nhiều từ dùng snake_case qua `name`.
- Với kiểu `string | null`, khai báo rõ `type` để tránh TypeORM suy luận thành `Object`.
- Chỉ thêm `CreateDateColumn`, `UpdateDateColumn`, `DeleteDateColumn` nếu nghiệp vụ cần.
- Hiện DB dùng `synchronize: true` cho local. Không trỏ ứng dụng vào DB production/dữ liệu quan trọng với cấu hình này.

## 2. DTO: dữ liệu đầu vào

Ví dụ `src/modules/product/dto/create-product.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  displayName!: string;
}
```

DTO phải là class có validation. `@ApiProperty()` chỉ mô tả Swagger, không kiểm tra dữ liệu. Global `ValidationPipe` đã bật `whitelist`, `forbidNonWhitelisted`, `transform`: field ngoài DTO bị từ chối. Không nhận các trường đặc quyền như `isAdmin` qua DTO đăng ký công khai.

## 3. Service: xử lý nghiệp vụ

Ví dụ `src/modules/product/product.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductEntity } from './product.entity';
import { CreateProductDto } from './dto/create-product.dto';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly repository: Repository<ProductEntity>,
  ) {}

  create(dto: CreateProductDto) {
    const product = this.repository.create({ displayName: dto.displayName });
    return this.repository.save(product);
  }
}
```

Đặt kiểm tra nghiệp vụ, quyền sở hữu và truy vấn DB ở service. Dùng `create()` rồi `save()` để lưu entity và chạy hook sinh ID. Chỉ chuyển lỗi đã biết thành `NotFoundException`, `ConflictException`, v.v.; không bắt mọi lỗi DB rồi đổi thành lỗi xác thực. Không trả password/hash/token nội bộ trong response.

## 4. Controller: nhận request và gọi service

Ví dụ `src/modules/product/product.controller.ts`:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/customize.decorator';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';

@ApiBearerAuth('access-token')
@Controller('products')
export class ProductController {
  constructor(private readonly service: ProductService) {}

  @Post()
  @ResponseMessage('Product created')
  create(@Body() dto: CreateProductDto) {
    return this.service.create(dto);
  }
}
```

Route ví dụ là `POST /api/v1/products`. JWT guard đã chạy toàn cục; chỉ dùng `@Public()` khi endpoint thực sự không cần đăng nhập. `@ApiBearerAuth()` chỉ cấu hình Swagger, không cấp quyền admin. Interceptor tự bọc `{ statusCode, message, data }`, nên controller chỉ trả dữ liệu, không bọc lại.

## 5. Đăng ký module và kiểm tra

Trong `ProductModule`, đăng ký:

```ts
@Module({
  imports: [TypeOrmModule.forFeature([ProductEntity])],
  controllers: [ProductController],
  providers: [ProductService],
})
export class ProductModule {}
```

Import các class tương ứng và import `ProductModule` vào `AppModule`. Chỉ thêm `exports: [ProductService]` khi module khác cần dùng service; module sử dụng phải import `ProductModule`.

Trước khi gửi code:

```sh
npx tsc --noEmit --incremental false
npm run build
```

Test cả request hợp lệ, DTO sai, thiếu JWT và lỗi nghiệp vụ liên quan. Xem API tại `/docs`. Không commit `.env` hoặc credential thật; cập nhật `.env.example` khi thêm biến cấu hình. Hướng dẫn chạy môi trường nằm trong `README.md`.
