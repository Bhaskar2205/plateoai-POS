import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * Dish photo uploads.
 *
 * Deliberately owns no database table: a photo is a file plus a URL, and the URL
 * lives on the dish. Keeping the module storage-only means the day these move
 * from a mounted volume to object storage, nothing outside this folder changes.
 */
@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
