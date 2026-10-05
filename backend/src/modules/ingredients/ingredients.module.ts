import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryModule } from 'src/modules/inventory/inventory.module';
import { Ingredient } from './entities/ingredient.entity';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';

@Module({
  // Opening stock is recorded as a movement, so creating an ingredient needs
  // the stock ledger.
  imports: [TypeOrmModule.forFeature([Ingredient]), InventoryModule],
  controllers: [IngredientsController],
  providers: [IngredientsService],
  exports: [IngredientsService, TypeOrmModule],
})
export class IngredientsModule {}
