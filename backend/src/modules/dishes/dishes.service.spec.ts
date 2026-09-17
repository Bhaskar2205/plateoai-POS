import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoriesService } from 'src/modules/categories/categories.service';
import { IngredientsService } from 'src/modules/ingredients/ingredients.service';
import { DishesService } from './dishes.service';
import { Dish } from './entities/dish.entity';

/**
 * Unit-level proof that the tenant filter is part of the query itself: these
 * assertions inspect the `where` clause the service hands to TypeORM.
 */
describe('DishesService', () => {
  let service: DishesService;
  let repository: jest.Mocked<Repository<Dish>>;
  let categoriesService: { existsInRestaurant: jest.Mock };
  let ingredientsService: { findAllByIdsInRestaurant: jest.Mock };

  const RESTAURANT_ID = 7;

  beforeEach(async () => {
    const repositoryMock = {
      create: jest.fn((input) => input),
      save: jest.fn(async (input) => ({ id: 1, ...input })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 1 }),
      remove: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    // Transactions run the callback against a manager backed by the same mock,
    // so assertions on `repository` see writes made inside the transaction.
    const dataSourceMock = {
      transaction: jest.fn((work: (manager: unknown) => unknown) =>
        work({ getRepository: () => repositoryMock }),
      ),
    };

    categoriesService = { existsInRestaurant: jest.fn().mockResolvedValue(true) };
    ingredientsService = { findAllByIdsInRestaurant: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DishesService,
        { provide: getRepositoryToken(Dish), useValue: repositoryMock },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: IngredientsService, useValue: ingredientsService },
        { provide: getDataSourceToken(), useValue: dataSourceMock },
      ],
    }).compile();

    service = moduleRef.get(DishesService);
    repository = moduleRef.get(getRepositoryToken(Dish));
  });

  describe('create', () => {
    it('stamps the dish with the active restaurant', async () => {
      await service.create(RESTAURANT_ID, { name: 'Bowl', price: 299 });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId: RESTAURANT_ID, name: 'Bowl', price: 299 }),
      );
    });

    it('defaults optional nutrition to null rather than inventing values', async () => {
      await service.create(RESTAURANT_ID, { name: 'Bowl', price: 299 });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          proteinGrams: null,
          calories: null,
          carbsGrams: null,
          fatGrams: null,
        }),
      );
    });

    it('defaults a dish to available', async () => {
      await service.create(RESTAURANT_ID, { name: 'Bowl', price: 299 });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isAvailable: true }),
      );
    });

    it('rejects a category that belongs to a different restaurant', async () => {
      categoriesService.existsInRestaurant.mockResolvedValue(false);

      await expect(
        service.create(RESTAURANT_ID, { name: 'Bowl', price: 299, categoryId: 42 }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects a recipe containing another restaurant ingredient before writing anything', async () => {
      ingredientsService.findAllByIdsInRestaurant.mockResolvedValue([]);

      await expect(
        service.create(RESTAURANT_ID, {
          name: 'Bowl',
          price: 299,
          ingredients: [{ ingredientId: 99, quantity: 10, unit: 'g' }],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.save).not.toHaveBeenCalled();
      expect(ingredientsService.findAllByIdsInRestaurant).toHaveBeenCalledWith(RESTAURANT_ID, [99]);
    });

    it('stores preparation time, defaulting to null when omitted', async () => {
      await service.create(RESTAURANT_ID, { name: 'Quick', price: 99, preparationTimeMinutes: 12 });
      expect(repository.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ preparationTimeMinutes: 12 }),
      );

      await service.create(RESTAURANT_ID, { name: 'Unknown', price: 99 });
      expect(repository.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ preparationTimeMinutes: null }),
      );
    });

    it('checks the category against the token restaurant, not the payload', async () => {
      await service.create(RESTAURANT_ID, { name: 'Bowl', price: 299, categoryId: 42 });

      expect(categoriesService.existsInRestaurant).toHaveBeenCalledWith(RESTAURANT_ID, 42);
    });
  });

  describe('findAll', () => {
    it('always filters by restaurant', async () => {
      await service.findAll(RESTAURANT_ID);

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ restaurantId: RESTAURANT_ID }) }),
      );
    });

    it('keeps the restaurant filter alongside caller filters', async () => {
      await service.findAll(RESTAURANT_ID, { categoryId: 3, isAvailable: true });

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            restaurantId: RESTAURANT_ID,
            categoryId: 3,
            isAvailable: true,
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('scopes the lookup by restaurant as well as id', async () => {
      repository.findOne.mockResolvedValue({ id: 5 } as Dish);

      await service.findOne(RESTAURANT_ID, 5);

      expect(repository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5, restaurantId: RESTAURANT_ID } }),
      );
    });

    it('reports another restaurant dish as not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne(RESTAURANT_ID, 5)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('refuses to delete a dish outside the active restaurant', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove(RESTAURANT_ID, 5)).rejects.toThrow(NotFoundException);
      expect(repository.remove).not.toHaveBeenCalled();
    });
  });
});
