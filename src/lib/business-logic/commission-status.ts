export type CommStatus = "cleared" | "payable" | "pending";

type CommStatusInput = {
  commissions_cleared: string | null;
  delivery_orders: { buyer_paid: string | null }[];
};

export function getCommissionStatus(po: CommStatusInput): CommStatus {
  if (po.commissions_cleared) return "cleared";
  const dos = po.delivery_orders ?? [];
  const fullyPaid = dos.length > 0 && dos.every((d) => d.buyer_paid);
  if (fullyPaid) return "payable";
  return "pending";
}
