# UU PDP for developers

A working summary of UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi for people building software, checked against the official text (JDIH Kemenkeu). It is not legal advice: several details are delegated to implementing regulations (Peraturan Pemerintah), so check whether those or guidance from the supervising authority have been issued since.

The law was enacted on 17 October 2022 and gave a two-year adjustment period (Pasal 74), so it has applied in full since 17 October 2024.

## What counts as personal data (Pasal 4)

| Data pribadi spesifik (stricter) | Data pribadi umum |
|---|---|
| Health data and information | Full name |
| Biometric data (face, fingerprint, …) | Gender |
| Genetic data | Nationality |
| Criminal records | Religion |
| Children's data | Marital status |
| Personal financial data | Personal data combined to identify someone (NIK, phone, email, address, IP, location, …) |

In code, treat birth date, phone number, email, address, NIK/KK, and device or location identifiers as personal data even though they are not listed one by one: combined, they identify a person.

## Legal basis for processing (Pasal 20)

Every use of personal data needs one of: explicit consent; performing a contract with the person; a legal obligation; protecting someone's vital interests; a task in the public interest; or another legitimate interest weighed against the person's rights. Write down which one each feature relies on.

Consent must be specific to a purpose and recorded. Store who consented, to what text (version), and when.

## Children (Pasal 25)

Processing children's data needs consent from a parent or guardian. If the product can be used by minors, ask for age and route minors through guardian consent.

## Rights of the data subject (Bab IV)

The person can: get information about the processing; access and get a copy of their data; correct it; have it deleted or processing stopped; withdraw consent; object to decisions made solely by automated processing, including profiling, that have legal or significant effects (Pasal 10); and restrict processing. Build account screens or support flows for each.

## Obligations that shape architecture

- **Purpose limitation and minimization**: collect only what the stated purpose needs; delete it when the retention period ends.
- **Security**: protect personal data against unauthorized access, disclosure, alteration, and loss. Encrypt spesifik data at rest, restrict admin access, keep audit logs of who viewed what.
- **Impact assessment (DPIA, Pasal 34)**: required for high-risk processing — automated decisions with legal or significant effects; spesifik data; large-scale processing; systematic evaluation, scoring, or monitoring; matching or combining datasets; new technology; or processing that limits the person's rights. Credit scoring and AI features that decide about people usually qualify.
- **Breach notification (Pasal 46)**: notify affected people and the authority in writing within 3 × 24 hours, stating what was exposed, when and how, and what is being done to handle and recover. In some cases the public must be told too.
- **Data protection officer (Pasal 53)**: required for processing for public services; when core activities need regular, systematic, large-scale monitoring; or when core activities are large-scale processing of spesifik data or criminal records. The Constitutional Court (Putusan 151/PUU-XXII/2024) read the "dan" in Pasal 53 ayat (1) huruf b as "dan/atau".
- **Processors**: a vendor that processes data for you (cloud, CRM, LLM API) must follow your instructions; you remain responsible. Put it in the contract.

## Cross-border transfer (Pasal 56)

Sending personal data outside Indonesia is allowed when the destination country's protection is equal or higher; otherwise adequate and binding safeguards must be in place; and failing both, the person's consent is required. Details are delegated to a Peraturan Pemerintah. Most LLM APIs, analytics, and SaaS tools are hosted abroad, so:

- Mask personal data before it leaves your servers (Samaran) wherever the feature works without the real values.
- Prefer regions or vendors with data residency options for spesifik data.
- List these vendors in the privacy policy.

## Sanctions

Administrative sanctions (Pasal 57) are written warnings, suspension of processing, deletion or destruction of data, and fines of up to 2% of annual revenue or receipts. Unlawfully obtaining, collecting, disclosing, or using personal data that is not yours, and falsifying personal data, are prohibited (Pasal 65–66) and punishable (Pasal 67–68) — for example up to 5 years in prison and/or a fine of up to Rp5 miliar for unlawfully obtaining or collecting it (Pasal 67 ayat 1).

## Checklist for a new feature

- [ ] Which personal data does it collect, and is each field necessary?
- [ ] Legal basis written down; consent recorded with purpose and version if consent is the basis.
- [ ] Any data pribadi spesifik or children's data? Extra protection and, if large-scale, a DPIA.
- [ ] Masked in logs, analytics, error trackers, and LLM prompts.
- [ ] Retention period and deletion job.
- [ ] Access, correction, deletion, and consent withdrawal reachable by the user.
- [ ] Third-party and cross-border processors listed.
