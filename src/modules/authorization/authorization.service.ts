import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { subject, type MongoAbility, type Subject } from "@casl/ability";
import { CaslAbilityFactory } from "./casl-ability.factory";
import type {
  AuthenticatedContext,
  AuthenticatedPrincipal,
  AuthorizationContext,
  GuestContext,
} from "./authorization.types";
import {
  assertNoPrototypePollution,
  normalizeResourceProjection,
  normalizeCreateCandidate,
} from "./subject-projections";
import {
  ACTIONS_BY_SUBJECT,
  type SubjectName,
  type ActionFor,
} from "./authorization.types";

const UPDATE_FIELDS: Partial<Record<SubjectName, readonly string[]>> = {
  Post: [
    "categoryId",
    "title",
    "description",
    "price",
    "condition",
    "location",
  ],
  User: ["fullName", "phone", "avatarUrl"],
  Review: ["rating", "comment"],
  Category: ["name", "parentId"],
};

const FORBIDDEN_PROTO_KEYS = new Set(["__proto__", "prototype", "constructor"]);

@Injectable()
export class AuthorizationService {
  constructor(private readonly factory: CaslAbilityFactory) {}

  createAuthenticatedContext(
    principal: AuthenticatedPrincipal,
  ): AuthenticatedContext {
    const normalized = { ...principal, id: principal.id.toLowerCase() };
    return {
      kind: "authenticated",
      principal: normalized,
      ability: this.factory.createForActor(normalized),
      serverIssued: true,
    };
  }

  createGuestContext(): GuestContext {
    return {
      kind: "guest",
      ability: this.factory.createForActor(null),
      serverIssued: true,
    };
  }

  assertRoute<S extends SubjectName>(
    context: AuthorizationContext,
    action: ActionFor<NoInfer<S>>,
    subjectName: S,
  ): void {
    const ability = context.ability as unknown as MongoAbility<
      [string, Subject]
    >;
    if (
      !(ACTIONS_BY_SUBJECT[subjectName] as readonly string[]).includes(action)
    )
      throw new InternalServerErrorException("Invalid action/subject");
    // Route gate on subject type only; instance check happens in service.
    const allowed = ability.can(action, subjectName);
    if (!allowed) {
      throw new ForbiddenException("Forbidden");
    }
  }

  assertResource<S extends SubjectName>(
    context: AuthorizationContext,
    action: ActionFor<NoInfer<S>>,
    subjectName: S,
    projection: Record<string, unknown>,
  ): void {
    if (!projection || typeof projection !== "object") {
      throw new InternalServerErrorException("Invalid subject projection");
    }
    const ability = context.ability as unknown as MongoAbility<
      [string, Subject]
    >;
    const allowed = ability.can(
      action,
      subject(
        subjectName,
        normalizeResourceProjection(subjectName, projection),
      ),
    );
    if (!allowed) {
      throw new ForbiddenException("Forbidden");
    }
  }

  assertCreate<
    S extends Extract<
      SubjectName,
      | "Post"
      | "Category"
      | "Report"
      | "Review"
      | "Favorite"
      | "Conversation"
      | "Upload"
    >,
  >(
    context: AuthorizationContext,
    subjectName: S,
    candidate: Record<string, unknown>,
  ): void {
    const ability = context.ability as unknown as MongoAbility<
      [string, Subject]
    >;
    if (
      !ability.can(
        "create",
        subject(subjectName, normalizeCreateCandidate(subjectName, candidate)),
      )
    )
      throw new ForbiddenException("Forbidden");
  }

  assertUpdateFields<S extends SubjectName>(
    context: AuthorizationContext,
    action: ActionFor<NoInfer<S>>,
    subjectName: S,
    projection: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): void {
    this.assertResource(context, action, subjectName, projection);
    const effective = this.effectivePatch(patch);
    const schema = UPDATE_FIELDS[subjectName];
    if (!schema) throw new InternalServerErrorException("No update schema");
    for (const field of Object.keys(effective)) {
      if (!schema.includes(field))
        throw new BadRequestException("Unknown field: " + field);
    }
    const ability = context.ability as unknown as MongoAbility<
      [string, Subject]
    >;
    const instance = subject(
      subjectName,
      normalizeResourceProjection(subjectName, projection),
    );
    for (const field of Object.keys(effective)) {
      if (FORBIDDEN_PROTO_KEYS.has(field) || field.includes(".")) {
        throw new BadRequestException("Invalid field: " + field);
      }
      const allowed = ability.can(action, instance, field);
      if (!allowed) {
        throw new ForbiddenException("Forbidden field: " + field);
      }
      if (
        field === "location" &&
        effective.location &&
        typeof effective.location === "object"
      ) {
        for (const child of Object.keys(effective.location)) {
          if (!ability.can(action, instance, "location." + child))
            throw new ForbiddenException("Forbidden nested field");
        }
      }
    }
  }

  effectivePatch(patch: Record<string, unknown>): Record<string, unknown> {
    assertNoPrototypePollution(patch);
    const proto = Object.getPrototypeOf(patch);
    if (proto !== Object.prototype && proto !== null) {
      throw new BadRequestException("Invalid patch prototype");
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      const value = (patch as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (FORBIDDEN_PROTO_KEYS.has(key) || key.includes(".")) {
        throw new BadRequestException("Invalid field: " + key);
      }
      out[key] = value;
    }
    // Nested location handling: allow location object with strict shape.
    if (out.location !== undefined && out.location !== null) {
      const loc = out.location as Record<string, unknown>;
      if (typeof loc !== "object" || Array.isArray(loc)) {
        throw new BadRequestException("Invalid field: location");
      }
      const allowedKeys = new Set(["type", "coordinates"]);
      for (const k of Object.getOwnPropertyNames(loc)) {
        if (!allowedKeys.has(k)) {
          throw new BadRequestException("Invalid field: location." + k);
        }
      }
      if (!Object.hasOwn(loc, "type") || !Object.hasOwn(loc, "coordinates")) {
        throw new BadRequestException("Invalid location shape");
      }
      out.location = { type: loc.type, coordinates: loc.coordinates };
    }
    return out;
  }
}
