import type { CustomerLicence, Party } from '@pharma-erp/database';

/**
 * A drug licence a customer holds, from whichever register records it.
 *
 * THERE ARE TWO STORES, and until this existed the Order-to-Cash screens
 * disagreed with each other about the same customer.
 *
 * `customer_licences` is Order-to-Cash's own register: several licences per
 * customer, each with a category, an issuing authority and a status the
 * authority can change. A customer created on the Order-to-Cash screens gets a
 * row here, and `syncPrimaryLicence` mirrors the primary one onto the party.
 *
 * `parties.drug_licence_number` / `drug_licence_valid_to` are the Master Data
 * fields, and they are the pair US-MD-02 enforces: a party cannot be an ACTIVE
 * CUSTOMER without them. A customer added on the Master Data screen — which is
 * now the only way customers are added — has these and no register row at all.
 *
 * Reading only the register therefore made every Master-Data customer look
 * unlicensed to the order gate while the Customers tab, which reads the party
 * fields, showed their licence as valid. Both screens now read this.
 *
 * BOTH ARE READ, and the customer is judged on their strongest standing — the
 * rule this code already applied among register rows. The two stores drift:
 * a licence renewed on the Master Data screen updates the party fields and
 * leaves the register row at its old expiry date, which is how a customer came
 * to read "9d left" on the Customers tab and "no valid licence" on the order.
 *
 * ONE LICENCE NUMBER IS ONE LICENCE. When both stores hold the same number,
 * they are the same licence recorded twice, and renewing it on the Master Data
 * screen is what moves its expiry date — so the later of the two dates is the
 * current one. The STATUS still comes from the register, which is the only
 * store that can say the authority has suspended or cancelled it.
 *
 * NOTHING IS WEAKENED. A licence must still exist and still be in date for an
 * order to pass, and a register licence that is SUSPENDED or CANCELLED still
 * fails however far in the future the party record says it runs.
 */
export interface LicenceOnFile {
  /** Null for the party's own fields: they are not a row in the register. */
  id: string | null;
  licenceNumber: string;
  expiryDate: Date;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  isPrimary: boolean;
  /** Where it was read from, so a caller can say so. */
  source: 'REGISTER' | 'PARTY';
}

/** Every licence recorded for a customer, from both stores. */
export function licencesOnFile(
  party: Pick<Party, 'drugLicenceNumber' | 'drugLicenceValidTo'>,
  register: readonly CustomerLicence[],
): LicenceOnFile[] {
  const live = register.filter((licence) => licence.deletedAt === null);

  const fromRegister: LicenceOnFile[] = live.map((licence) => ({
    id: licence.id,
    licenceNumber: licence.licenceNumber,
    expiryDate: licence.expiryDate,
    status: licence.status,
    isPrimary: licence.isPrimary,
    source: 'REGISTER',
  }));

  // Both halves are required. A number with no validity date says nothing
  // about whether it is still good, so it is not a licence to sell against.
  if (!party.drugLicenceNumber || !party.drugLicenceValidTo) return fromRegister;

  // Same number in both stores: one licence, so take the register's status and
  // whichever expiry date runs longer rather than listing it twice.
  const registered = fromRegister.find(
    (licence) => licence.licenceNumber === party.drugLicenceNumber,
  );

  if (registered) {
    return fromRegister.map((licence) =>
      licence === registered
        ? {
            ...licence,
            expiryDate:
              party.drugLicenceValidTo! > licence.expiryDate
                ? party.drugLicenceValidTo!
                : licence.expiryDate,
          }
        : licence,
    );
  }

  return [
    ...fromRegister,
    {
      id: null,
      licenceNumber: party.drugLicenceNumber,
      expiryDate: party.drugLicenceValidTo,
      // The party record has no status column. US-MD-02 is what keeps it
      // meaningful: an ACTIVE customer cannot hold blank licence fields, so a
      // licence the authority withdrew is recorded by clearing them.
      status: 'ACTIVE',
      isPrimary: fromRegister.length === 0,
      source: 'PARTY',
    },
  ];
}
