import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBadRequestResponse, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { MENU_WRITE_ROLES } from 'src/common/enums';
import { DishPhotoDto } from './dto/dish-photo.dto';
import { ACCEPTED_MIME_TYPES, UploadsService } from './uploads.service';

/**
 * Photo uploads for the menu.
 *
 * Same roles as editing the menu, because that is what a photo is: a menu edit.
 * The upload only stores the file and hands back a URL - saving it onto a dish is
 * a separate call to the dishes API, so a half-finished form never changes the
 * live menu.
 */
@ApiTags('Menu')
@ApiAuth()
@Roles(...MENU_WRITE_ROLES)
@Controller('restaurants/me/uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('dish-photo')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      // Kept in memory: the file is re-encoded and written once, so a temporary
      // copy on disk would only be another thing to clean up.
      limits: { fileSize: 12 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload a dish photo',
    description:
      `Accepts a ${ACCEPTED_MIME_TYPES.join(', ')} image. The photo is re-encoded as WebP, resized to ` +
      'fit 1600px and stripped of EXIF (including any GPS location) before it is stored, and the ' +
      'stored URL is returned. Save that URL as the dish\'s `imageUrl`.',
  })
  @ApiCreatedResponse({ type: DishPhotoDto })
  @ApiBadRequestResponse({
    description: 'Not an image, an unreadable image, or larger than the limit.',
    type: ErrorResponseDto,
  })
  async uploadDishPhoto(
    @ActiveRestaurantId() restaurantId: number,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<DishPhotoDto> {
    return this.uploadsService.storeDishPhoto(restaurantId, file);
  }
}
