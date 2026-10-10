import type { MongoAbility, ForcedSubject } from "@casl/ability";
import type {
  PostProjection,
  CategoryProjection,
  UserProjection,
  ReportProjection,
  ReviewProjection,
  FavoriteProjection,
  ConversationProjection,
  NotificationProjection,
} from "./subject-projections";

export type PostAction =
  | "create"
  | "read"
  | "update"
  | "markSold"
  | "delete"
  | "restore"
  | "manageImages"
  | "hide";
export type CategoryAction = "create" | "read" | "update" | "delete";
export type UserAction =
  | "read"
  | "update"
  | "updateLocation"
  | "delete"
  | "changePassword"
  | "lock"
  | "unlock";
export type ReportAction = "create" | "read" | "resolve";
export type ReviewAction = "create" | "read" | "update" | "delete";
export type FavoriteAction = "create" | "read" | "delete";
export type ConversationAction =
  | "create"
  | "read"
  | "readMessages"
  | "sendMessage"
  | "markRead"
  | "join"
  | "type";
export type NotificationAction = "read" | "markRead";
export type UploadAction = "create";

export type AppAbilities =
  | [PostAction, "Post"]
  | [CategoryAction, "Category"]
  | [UserAction, "User"]
  | [ReportAction, "Report"]
  | [ReviewAction, "Review"]
  | [FavoriteAction, "Favorite"]
  | [ConversationAction, "Conversation"]
  | [NotificationAction, "Notification"]
  | [UploadAction, "Upload"];

export type SubjectName = AppAbilities[1];
export type ActionFor<S extends SubjectName> = Extract<
  AppAbilities,
  [unknown, S]
>[0];
type SubjectFields = {
  Post: PostProjection;
  Category: CategoryProjection;
  User: UserProjection;
  Report: ReportProjection;
  Review: ReviewProjection;
  Favorite: FavoriteProjection;
  Conversation: ConversationProjection;
  Notification: NotificationProjection;
  Upload: { ownerId: string; purpose: string };
};
export type AppAbility = MongoAbility<
  {
    [S in SubjectName]: [
      ActionFor<S>,
      S | (Partial<SubjectFields[S]> & ForcedSubject<S>),
    ];
  }[SubjectName]
>;
export const ACTIONS_BY_SUBJECT = {
  Post: [
    "create",
    "read",
    "update",
    "markSold",
    "delete",
    "restore",
    "manageImages",
    "hide",
  ],
  Category: ["create", "read", "update", "delete"],
  User: [
    "read",
    "update",
    "updateLocation",
    "delete",
    "changePassword",
    "lock",
    "unlock",
  ],
  Report: ["create", "read", "resolve"],
  Review: ["create", "read", "update", "delete"],
  Favorite: ["create", "read", "delete"],
  Conversation: [
    "create",
    "read",
    "readMessages",
    "sendMessage",
    "markRead",
    "join",
    "type",
  ],
  Notification: ["read", "markRead"],
  Upload: ["create"],
} as const satisfies { [S in SubjectName]: readonly ActionFor<S>[] };

export interface AuthenticatedPrincipal {
  id: string;
  email: string;
  fullName: string;
  isAdmin: boolean;
}

export interface AuthenticatedContext {
  kind: "authenticated";
  principal: AuthenticatedPrincipal;
  ability: AppAbility;
  serverIssued: true;
}

export interface GuestContext {
  kind: "guest";
  ability: AppAbility;
  serverIssued: true;
}

export type AuthorizationContext = AuthenticatedContext | GuestContext;

export type PolicyRequirement = {
  [S in SubjectName]: { action: ActionFor<S>; subject: S };
}[SubjectName];

export function isAuthenticatedContext(
  ctx: AuthorizationContext,
): ctx is AuthenticatedContext {
  return ctx.kind === "authenticated";
}
