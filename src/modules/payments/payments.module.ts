import { PromotionEligibilityService } from "./promotion-eligibility.service";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PaymentOrder, PaymentRequest } from "./payment.entity";
import { PromotionsModule } from "../promotions/promotions.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentOrder, PaymentRequest]),
    PromotionsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PromotionEligibilityService],
})
export class PaymentsModule {}
