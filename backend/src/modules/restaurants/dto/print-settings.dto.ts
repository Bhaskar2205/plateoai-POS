import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** The three widths thermal rolls are sold in. */
export const PAPER_WIDTHS_MM = [58, 80, 112] as const;

/**
 * What a restaurant prints on its bills, beyond the figures.
 *
 * Two things live here: the payment QR, and the width of the roll the printer
 * takes. Everything else about the two documents - how much of the roll the
 * head can reach, what type size fits, which fields each one carries - follows
 * from the paper and from what a kitchen and a tax invoice have to say, so it
 * is worked out in the apps rather than stored per restaurant.
 */
export class PrintSettingsDto {
  @ApiProperty({
    nullable: true,
    example: 'https://api.plateoai.in/uploads/logo/3/a1b2.png',
    description: "The restaurant's logo, printed across the top of a bill, or null.",
  })
  logoUrl: string | null;

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

  @ApiProperty({
    example: 80,
    enum: PAPER_WIDTHS_MM,
    description: 'The thermal roll this restaurant prints on, in millimetres.',
  })
  paperWidthMm: number;
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

  @ApiPropertyOptional({
    example: 58,
    enum: PAPER_WIDTHS_MM,
    description:
      'The roll the printer takes. Set it to match the paper actually loaded: a bill laid out ' +
      'for 80mm comes off the right-hand edge of a 58mm roll.',
  })
  @IsOptional()
  @IsIn(PAPER_WIDTHS_MM as unknown as number[])
  paperWidthMm?: number;
}
