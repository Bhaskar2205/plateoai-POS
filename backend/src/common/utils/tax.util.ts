import { DiscountType, TAX_KINDS, TaxGroup, TaxKind } from 'src/common/enums';
import { fromPaise, roundHalfUp, toPaise, type DiscountInput } from './money.util';

/**
 * What an Indian restaurant bill actually owes, component by component.
 *
 * Every figure is integer paise until the last step, for the reasons in
 * money.util. What this adds is the shape of the bill itself:
 *
 *  - A discount reduces the taxable value, so tax is computed after it.
 *  - A service charge is part of the value of the supply, so GST applies on top
 *    of it - not the other way round.
 *  - Lines are not all taxed alike. Alcohol is outside GST and carries state VAT;
 *    a sealed packaged item can carry its own rate; some lines carry nothing. A
 *    charge therefore names the group it applies to, and each group is taxed on
 *    its own share of the bill.
 *  - Each component is rounded once, on its own base. Rounding the total instead
 *    would make CGST and SGST disagree by a paisa on odd amounts, and a bill
 *    whose halves do not match its total is not one a guest will accept.
 *
 * TDS is deliberately not a tax here. It is deducted by whoever pays - a company
 * settling a party bill - and it reduces what the restaurant receives without
 * changing what is owed in GST. Its base is the value *before* GST, which is what
 * CBDT Circular 23/2017 directs when tax is shown separately on the invoice.
 */

/** A charge the restaurant has configured, or one added to a single bill. */
export interface TaxComponentInput {
  name: string;
  kind: TaxKind;
  /** Percentage, e.g. 2.5 for CGST at 2.5%. */
  rate: number;
  appliesTo: TaxGroup;
}

export interface TaxableLineInput {
  unitPrice: number;
  quantity: number;
  taxGroup: TaxGroup;
}

/** One line of the bill's tax breakdown, ready to store and to print. */
export interface ComputedCharge {
  name: string;
  kind: TaxKind;
  rate: number;
  /** What this rate was applied to. */
  taxableAmount: number;
  amount: number;
}

export interface ComputedBill {
  subtotal: number;
  discountAmount: number;
  /** Subtotal less discount: the value of the supply before any charge. */
  taxableAmount: number;
  serviceChargeAmount: number;
  /** Every tax component, in the order the charges were given. */
  charges: ComputedCharge[];
  /** The tax components only, summed. Excludes the service charge. */
  taxAmount: number;
  /** taxable + service charge + tax. What the guest owes. */
  total: number;
  tdsRate: number | null;
  tdsAmount: number;
  /** total less any TDS the payer withholds. What the restaurant receives. */
  amountPayable: number;
}

const isTax = (kind: TaxKind): boolean => TAX_KINDS.includes(kind);

/**
 * Splits a whole-bill discount across tax groups in proportion to what each
 * group contributes, so a group's taxable base reflects its share of the
 * reduction. The remainder lands on the largest group, so the parts always add
 * back to the discount exactly rather than drifting by a paisa.
 */
function apportion(totalPaise: number, byGroup: Map<TaxGroup, number>, subtotalPaise: number): Map<TaxGroup, number> {
  const shares = new Map<TaxGroup, number>();
  if (subtotalPaise === 0 || totalPaise === 0) {
    for (const group of byGroup.keys()) shares.set(group, 0);
    return shares;
  }

  let assigned = 0;
  let largest: TaxGroup | null = null;

  for (const [group, groupPaise] of byGroup) {
    const share = roundHalfUp((totalPaise * groupPaise) / subtotalPaise);
    shares.set(group, share);
    assigned += share;
    if (largest === null || groupPaise > (byGroup.get(largest) ?? 0)) largest = group;
  }

  if (largest !== null && assigned !== totalPaise) {
    shares.set(largest, (shares.get(largest) ?? 0) + (totalPaise - assigned));
  }

  return shares;
}

function discountPaiseFor(subtotalPaise: number, discount: DiscountInput): number {
  if (discount.type === null || discount.value === null || discount.value <= 0) return 0;

  return discount.type === DiscountType.PERCENT
    ? roundHalfUp((subtotalPaise * discount.value) / 100)
    : toPaise(discount.value);
}

export function computeBill(
  lines: TaxableLineInput[],
  discount: DiscountInput,
  components: TaxComponentInput[],
  tdsRate: number | null = null,
): ComputedBill {
  const byGroup = new Map<TaxGroup, number>();
  let subtotalPaise = 0;

  for (const line of lines) {
    const linePaise = toPaise(line.unitPrice) * line.quantity;
    subtotalPaise += linePaise;
    byGroup.set(line.taxGroup, (byGroup.get(line.taxGroup) ?? 0) + linePaise);
  }

  const discountPaise = Math.min(discountPaiseFor(subtotalPaise, discount), subtotalPaise);
  const discountByGroup = apportion(discountPaise, byGroup, subtotalPaise);

  /** Each group's value after its share of the discount. */
  const baseByGroup = new Map<TaxGroup, number>();
  for (const [group, groupPaise] of byGroup) {
    baseByGroup.set(group, groupPaise - (discountByGroup.get(group) ?? 0));
  }

  const baseFor = (appliesTo: TaxGroup): number => baseByGroup.get(appliesTo) ?? 0;

  // A service charge is part of the value the guest is billed, so it is worked
  // out first and then taxed along with the food it sits on.
  const serviceByGroup = new Map<TaxGroup, number>();
  const serviceCharges: ComputedCharge[] = [];
  let servicePaise = 0;

  for (const component of components) {
    if (component.kind !== TaxKind.SERVICE_CHARGE) continue;

    const base = baseFor(component.appliesTo);
    const amount = roundHalfUp((base * component.rate) / 100);

    serviceByGroup.set(component.appliesTo, (serviceByGroup.get(component.appliesTo) ?? 0) + amount);
    servicePaise += amount;
    serviceCharges.push({
      name: component.name,
      kind: component.kind,
      rate: component.rate,
      taxableAmount: fromPaise(base),
      amount: fromPaise(amount),
    });
  }

  const taxCharges: ComputedCharge[] = [];
  let taxPaise = 0;

  for (const component of components) {
    if (!isTax(component.kind)) continue;

    const base = baseFor(component.appliesTo) + (serviceByGroup.get(component.appliesTo) ?? 0);
    const amount = roundHalfUp((base * component.rate) / 100);

    taxPaise += amount;
    taxCharges.push({
      name: component.name,
      kind: component.kind,
      rate: component.rate,
      taxableAmount: fromPaise(base),
      amount: fromPaise(amount),
    });
  }

  const taxablePaise = subtotalPaise - discountPaise;
  const totalPaise = taxablePaise + servicePaise + taxPaise;

  // Withheld on the value before GST, per CBDT Circular 23/2017.
  const tdsPaise =
    tdsRate === null || tdsRate <= 0
      ? 0
      : roundHalfUp(((taxablePaise + servicePaise) * tdsRate) / 100);

  return {
    subtotal: fromPaise(subtotalPaise),
    discountAmount: fromPaise(discountPaise),
    taxableAmount: fromPaise(taxablePaise),
    serviceChargeAmount: fromPaise(servicePaise),
    charges: [...serviceCharges, ...taxCharges],
    taxAmount: fromPaise(taxPaise),
    total: fromPaise(totalPaise),
    tdsRate: tdsRate === null || tdsRate <= 0 ? null : tdsRate,
    tdsAmount: fromPaise(tdsPaise),
    amountPayable: fromPaise(totalPaise - tdsPaise),
  };
}

/**
 * The combined tax percentage a bill carried, for the one-line summary older
 * screens and the existing `tax_rate` column still show. Derived rather than
 * stored, because the components are the truth.
 */
export function effectiveTaxRate(bill: Pick<ComputedBill, 'taxableAmount' | 'serviceChargeAmount' | 'taxAmount'>): number {
  const base = toPaise(bill.taxableAmount) + toPaise(bill.serviceChargeAmount);
  if (base === 0) return 0;

  return roundHalfUp((toPaise(bill.taxAmount) * 10_000) / base) / 100;
}
