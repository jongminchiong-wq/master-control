// Design system tokens — reference for programmatic use
// Colors and fonts are primarily configured in globals.css via @theme inline
// This file exports constants for use in business logic or dynamic styling

export const ROLE_COLORS = {
  endUser: "brand",
  introducer: "purple",
  investor: "accent",
  entity: "brand",
  cost: "danger",
  success: "success",
  warning: "amber",
  danger: "danger",
} as const;
