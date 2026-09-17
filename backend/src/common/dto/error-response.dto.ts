import { ApiProperty } from '@nestjs/swagger';

/** The single error envelope every failing Plateo endpoint returns. */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({
    example: 'Validation failed',
    description: 'Human readable summary of what went wrong.',
  })
  message: string;

  @ApiProperty({
    required: false,
    type: [String],
    example: ['price must not be less than 0'],
    description: 'Field-level validation problems, when applicable.',
  })
  details?: string[];

  @ApiProperty({ example: '/dishes' })
  path: string;

  @ApiProperty({ example: '2026-01-01T12:00:00.000Z' })
  timestamp: string;
}
