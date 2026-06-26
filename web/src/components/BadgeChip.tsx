import { badgeLabel, type BadgeTier } from "@safesips/shared";

export default function BadgeChip({ tier }: { tier: BadgeTier }) {
  return (
    <span className={`badge-chip badge-${tier}`} title={badgeLabel(tier)}>
      {badgeLabel(tier)}
    </span>
  );
}
