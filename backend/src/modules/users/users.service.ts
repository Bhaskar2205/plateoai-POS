import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { UserRole } from 'src/common/enums';
import { User } from './entities/user.entity';

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  /**
   * Emails are stored and compared lower-cased so `Owner@x.com` and
   * `owner@x.com` cannot register twice.
   */
  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  /**
   * How floor staff are found at sign-in. Codes are stored and compared folded
   * to lower case, so a captain typing RAMESH at a table still gets in.
   */
  findByStaffCode(staffCode: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { staffCode: staffCode.trim().toLowerCase() } });
  }

  findById(id: number): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async getById(id: number): Promise<User> {
    const user = await this.findById(id);

    if (!user) {
      throw new NotFoundException(`User ${id} was not found.`);
    }

    return user;
  }

  async emailExists(email: string, manager?: EntityManager): Promise<boolean> {
    const repository = manager ? manager.getRepository(User) : this.usersRepository;
    const count = await repository.count({ where: { email: email.trim().toLowerCase() } });
    return count > 0;
  }

  /**
   * `manager` lets registration create the user inside the same transaction as
   * the restaurant and the membership row.
   */
  create(input: CreateUserInput, manager?: EntityManager): Promise<User> {
    const repository = manager ? manager.getRepository(User) : this.usersRepository;

    const user = repository.create({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      passwordHash: input.passwordHash,
      role: input.role,
    });

    return repository.save(user);
  }
}
