import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

/**
 * Presence là value !== undefined (null, chuỗi rỗng vẫn tính là "có mặt"
 * để field-level IsUUID báo 400 thay vì bị bỏ qua). Không dùng truthiness
 * và không dùng ValidateIf bỏ hết validation khi cả hai field có mặt
 * (spec §4.1).
 */
@ValidatorConstraint({ name: "exactlyOneTarget", async: false })
class ExactlyOneTargetConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    const hasPost = obj["postId"] !== undefined;
    const hasConv = obj["conversationId"] !== undefined;
    return hasPost !== hasConv;
  }

  defaultMessage(): string {
    return "Exactly one of postId or conversationId must be provided";
  }
}

export function IsExactlyOneTarget(
  validationOptions?: ValidationOptions,
): ClassDecorator {
  return (target: object) => {
    registerDecorator({
      name: "isExactlyOneTarget",
      // ClassDecorator nhận constructor — dùng trực tiếp, không .constructor.
      target: target as unknown as new (...args: unknown[]) => unknown,
      // Gắn vào clientId (không có ValidateIf): @ValidateIf trên postId /
      // conversationId khiến class-validator bỏ qua toàn bộ group validation
      // của property vắng mặt — kể cả check XOR này. Check đọc args.object
      // nên property gắn vào chỉ quyết định grouping, không ảnh hưởng logic.
      propertyName: "clientId",
      options: validationOptions,
      validator: ExactlyOneTargetConstraint,
    });
  };
}
