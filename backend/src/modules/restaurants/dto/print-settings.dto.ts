import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * What a restaurant prints on its bills, beyond the figures.
 *
 * Only the payment QR lives here. Everything else about the two documents - the
 * roll width, the dot pitch, which fields each one carries - is fixed by the
 * paper and by what a kitchen and a tax invoice have to say, so it is a constant
 * in the apps rather than a per-restaurant setting nobody would ever change.
 */
export class PrintSettingsDto {
  @ApiProperty({
    nullable: true,
    example: 'https://api.plateoai.in/uploads/payment-qr/3/a1b2.png',
    description: 'The uploaded payment code, or null when none has been added.',
  })
  paymentQrUrl: string | null;

  @ApiProperty({
    nullable: true,
    example: 'greenbowl@okhdfcbank',
    description: 'Printed under the QR so a guest can check who they are paying.',
  })
  paymentQrLabel: string | null;

  @ApiProperty({
    example: false,
    description:
      'When true the QR is printed on bills until this is switched off again. Has no effect ' +
      'while no QR has been uploaded.',
  })
  printPaymentQr: boolean;
}

export class UpdatePrintSettingsDto {
  @ApiPropertyOptional({
    example: 'greenbowl@okhdfcbank',
    maxLength: 100,
    description: 'Send an empty string to clear it.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  paymentQrLabel?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Tick once; every bill carries the QR until it is unticked.',
  })
  @IsOptional()
  @IsBoolean()
  printPaymentQr?: boolean;
}
