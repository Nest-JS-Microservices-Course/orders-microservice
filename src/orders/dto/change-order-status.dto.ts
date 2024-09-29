import { OrderStatus } from "@prisma/client";
import { IsEnum, IsUUID } from "class-validator";
import { OrderStatusList } from "../enum/enum.order";

export class ChangeOrderStatusDto {

  @IsUUID(4)
  id: string;

  @IsEnum(OrderStatusList,
    {
      message: `Possible status values are ${OrderStatusList}`
    }
  )
  status: OrderStatus
}
