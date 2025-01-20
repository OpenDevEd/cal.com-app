import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsDateString, IsOptional } from "class-validator";

export class ReserveSlotInput_2024_09_04 {
  @IsInt()
  @ApiProperty({ example: 1, description: "The ID of the event type for which booking should be reserved." })
  eventTypeId!: number;

  @IsDateString()
  @ApiProperty({
    example: "2024-09-04T09:00:00Z",
    description: "ISO 8601 datestring in UTC timezone representing available slot.",
  })
  slotStart!: string;

  @IsInt()
  @IsOptional()
  @ApiProperty({
    example: "30",
    description:
      "By default slot duration is equal to event type length, but if you want to reserve a slot for an event type that has a variable length you can specify it here. If you don't have this set explicitly that event type can have one of many lengths you can omit this.",
  })
  slotDuration?: number;

  @IsInt()
  @IsOptional()
  @ApiPropertyOptional({
    example: 5,
    description:
      "For how many minutes the slot should be reserved - for this long time noone else can book this event type at `start` time.",
  })
  reservationDuration = 5;
}
