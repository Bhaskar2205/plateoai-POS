import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TaxKind } from 'src/common/enums';
import { numericTransformer } from 'src/common/transformers/numeric.transformer';
import { Order } from './order.entity';

/**
 * One line of a bill's tax breakdown, as it was charged.
 *
 * A snapshot, not a reference: the name, the kind and the rate are copied from
 * the restaurant's tax profile when the bill is computed. A restaurant that
 * changes its service charge next month must not change what last month's
 * settled bills say they charged, and a bill that has been handed to a guest has
 * to stay reproducible exactly.
 *
 * Rows are rewritten every time the bill is recalculated while it is open, and
 * frozen once it is settled.
 */
@Entity('order_charges')
@Index('IDX_order_charges_order', ['orderId'])
export class OrderCharge {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 42 })
  @Column({ type: 'int', unsigned: true, name: 'order_id' })
  orderId: number;

  @ManyToOne(() => Order, (order) => order.charges, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @ApiProperty({ example: 'CGST' })
  @Column({ type: 'varchar', length: 40 })
  name: string;

  @ApiProperty({ enum: TaxKind, example: TaxKind.CGST })
  @Column({ type: 'varchar', length: 16 })
  kind: TaxKind;

  @ApiProperty({ example: 2.5 })
  @Column({ type: 'decimal', precision: 5, scale: 2, transformer: numericTransformer })
  rate: number;

  @ApiProperty({ example: 600, description: 'The amount this rate was applied to.' })
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'taxable_amount',
    default: 0,
    transformer: numericTransformer,
  })
  taxableAmount: number;

  @ApiProperty({ example: 15 })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: numericTransformer })
  amount: number;

  @ApiProperty({ example: 1 })
  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;
}
