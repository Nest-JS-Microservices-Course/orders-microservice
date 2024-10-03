import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChangeOrderStatusDto, CreateOrderDto } from './dto'
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { NATS_SERVICE } from 'src/config/services';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy
  ) { super() }

  private readonly logger = new Logger('OrdersMicroservice')

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database Connected')
  }

  async create(createOrderDto: CreateOrderDto) {

    try {

      // Confirmar los ids de los productos
      const productIds = createOrderDto.items.map(item => item.productId)

      const products: any[] = await firstValueFrom(
        this.client.send({ cmd: 'validate_products' }, productIds)
      );

      // Calculos de valores
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find(product => product.id === orderItem.productId).price;

        return price * orderItem.quantity
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity
      }, 0);

      // Transaccion de base de datos
      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map(orderItem => ({
                price: products.find(
                  product => product.id === orderItem.productId
                ).price,
                productId: orderItem.productId,
                quantity: orderItem.quantity
              }))
            }
          }
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true,
            }
          }
        }
      });

      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find(product => product.id === orderItem.productId).name
        }))
      }

    } catch (error) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: 'Some product/s were not found!'
      })
    }



    // return this.order.create({
    //   data: createOrderDto
    // });
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {

    const totalPages = await this.order.count({
      where: {
        status: orderPaginationDto.status
      }
    });

    const currentPage = orderPaginationDto.page;
    const perPage = orderPaginationDto.limit

    return {
      data: await this.order.findMany({
        where: {
          status: orderPaginationDto.status
        },
        skip: (currentPage - 1) * perPage,
        take: perPage
      }),
      metadata: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil(totalPages / perPage)
      }
    }
  }

  async findOne(id: string) {

    const order = await this.order.findFirst({
      where: { id },
      include: {
        OrderItem: {
          select: {
            price: true,
            quantity: true,
            productId: true
          }
        }
      }
    });

    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with the id ${id} not found`
      })
    };

    const productsIds = order.OrderItem.map( orderItem => orderItem.productId );

    const products: any[] = await firstValueFrom(
      this.client.send({ cmd: 'validate_products' }, productsIds)
    );

    return {
      ...order,
      OrderItem: order.OrderItem.map( (orderItem) => ({
        ...orderItem,
        name: products.find( product => product.id === orderItem.productId ).name
      }) )

    };
  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {

    const { id, status } = changeOrderStatusDto;

    const order = await this.findOne(id)

    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with the id ${id} not found`
      })
    }

    if (order.status === status) {
      return order
    }

    return this.order.update({
      where: { id },
      data: { status }

    })

  }
}
