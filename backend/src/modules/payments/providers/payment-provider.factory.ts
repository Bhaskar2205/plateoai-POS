import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentProviderName, PaymentProviderStatus } from 'src/common/enums';
import { InternalPaymentProvider } from './internal.provider';
import { PaymentProvider } from './payment-provider.interface';
import { RazorpayPaymentProvider } from './razorpay.provider';

/**
 * Picks the provider for a payment.
 *
 * The one rule worth stating: an unconfigured provider is never silently
 * replaced by a working one. Asking for Razorpay when Razorpay has no
 * credentials is an error the caller must see, not an invitation to fall back to
 * the internal provider and record the bill as paid in cash. That substitution
 * would be invisible on every screen and wrong on every report.
 */
@Injectable()
export class PaymentProviderFactory {
  private readonly providers: Map<PaymentProviderName, PaymentProvider>;

  constructor(
    internal: InternalPaymentProvider,
    razorpay: RazorpayPaymentProvider,
  ) {
    this.providers = new Map<PaymentProviderName, PaymentProvider>([
      [internal.name, internal],
      [razorpay.name, razorpay],
      // CASHFREE_FUTURE is named in the enum but has no implementation. It is
      // absent from this map on purpose, so asking for it fails rather than
      // resolving to something that is not Cashfree.
    ]);
  }

  /** The provider, whether or not it can currently be used. */
  find(name: PaymentProviderName): PaymentProvider | undefined {
    return this.providers.get(name);
  }

  /** The provider, only if it can actually take a payment right now. */
  require(name: PaymentProviderName): PaymentProvider {
    const provider = this.providers.get(name);

    if (!provider) {
      throw new BadRequestException(`${name} is not a payment provider Plateo supports yet.`);
    }

    if (provider.status() !== PaymentProviderStatus.READY) {
      throw new BadRequestException(
        `${name} is not configured, so it cannot take payments. Configure it, or take this payment another way.`,
      );
    }

    return provider;
  }

  /** What to show on the settings screen: every provider and its real state. */
  describeAll(): Array<{ provider: PaymentProviderName; status: PaymentProviderStatus }> {
    return Object.values(PaymentProviderName).map((name) => {
      const provider = this.providers.get(name);

      return {
        provider: name,
        status: provider?.status() ?? PaymentProviderStatus.UNAVAILABLE,
      };
    });
  }
}
