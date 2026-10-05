import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TaxGroup, TaxKind } from 'src/common/enums';
import { numericTransformer } from 'src/common/transformers/numeric.transformer';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';

/**
 * One charge in a restaurant's tax profile, such as CGST at 2.5%.
 *
 * A restaurant configures these once and every new bill inherits them. They are
 * separate rows rather than a single rate on the restaurant because an Indian
 * bill has to print each component on its own line, and because the components a
 * restaurant needs differ: 2.5 + 2.5 within a state, 5 as IGST across one, VAT
 * on alcohol alongside GST on food.
 *
 * A bill copies these onto itself when it is computed (see `OrderCharge`), so
 * changing a rate here never rewrites what an already-settled bill charged.
 */
@Entity('restaurant_tax_components')
@Index('IDX_tax_components_restaurant', ['restaurantId'])
export class TaxComponent {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 1 })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: Restaurant;

  @ApiProperty({ example: 'CGST', description: 'What prints on the bill.' })
  @Column({ type: 'varchar', length: 40 })
  name: string;

  @ApiProperty({ enum: TaxKind, example: TaxKind.CGST })
  @Column({ type: 'varchar', length: 16 })
  kind: TaxKind;

  @ApiProperty({ example: 2.5, description: 'Percentage. 2.5 means 2.5%.' })
  @Column({ type: 'decimal', precision: 5, scale: 2, transformer: numericTransformer })
  rate: number;

  @ApiProperty({
    enum: TaxGroup,
    example: TaxGroup.STANDARD,
    description: 'Which dishes this applies to, matched against the dish tax group.',
  })
  @Column({ type: 'varchar', length: 16, name: 'applies_to', default: TaxGroup.STANDARD })
  appliesTo: TaxGroup;

  @ApiProperty({ example: true, description: 'Switched off rather than deleted, so history reads straight.' })
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @ApiProperty({ example: 1, description: 'Order the components print in.' })
  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
