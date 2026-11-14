# Payroll and statutory deductions (Kenya)

> **Payroll is where mistakes cost real money and penalties.** The rates below were checked against several published sources on 14 November 2026, and the calculation was verified against hand-worked examples. It has **not** been compared with a real payslip or a KRA iTax return. An accountant must confirm the rates and the first payroll before anyone is paid from it.

## Rates built in (effective 1 February 2026)

| Item | Rule | Notes |
|---|---|---|
| **NSSF** (employee and employer, each) | 6% of pensionable pay up to the upper earnings limit of **KES 108,000** (maximum KES 6,480 each) | Year 4 of the NSSF Act 2013 schedule. The lower limit (KES 9,000) only splits the contribution between Tier I and Tier II; the total is the same |
| **SHIF** (employee only) | **2.75%** of gross pay, minimum **KES 300** | Replaced NHIF |
| **Affordable housing levy** | **1.5%** of gross pay from the employee **and** 1.5% from the employer | |
| **PAYE** | Taxable pay = gross − NSSF − SHIF − employee housing levy. Bands per month: first KES 24,000 at 10%; next 8,333 at 25%; next 467,667 at 30%; next 300,000 at 32.5%; above KES 800,000 at 35% | |
| **Personal relief** | KES 2,400 per month, deducted from the tax | |

## Worked example (also an automated test)

Gross KES 50,000: NSSF 3,000, SHIF 1,375, housing levy 750, taxable pay 44,875. Tax: 2,400.00 + 2,083.25 + 3,762.60 = 8,245.85, less relief 2,400 = **PAYE 5,845.85**. Net pay **39,029.15**. Employer cost: 50,000 + 3,000 NSSF + 750 housing levy = 53,750.

Other tested cases: a KES 10,000 salary (SHIF minimum applies, relief wipes out PAYE), KES 100,000 (PAYE 19,308.35), and KES 200,000 (NSSF capped at 6,480).

## What can change under you

**The Treasury has said it will table a bill to exempt earnings up to KES 32,333 from PAYE and change personal relief** (reported 23 October 2026). It is a proposal, not law. If it passes, the rates here become wrong **until you update them**. Rates are stored per business as settings (`payroll_rates`, owner only) so they can be changed without a software release, but **nothing warns you when the law changes**. The rates carry an "effective" date and every payroll run saves a copy of the rates it used, so past payslips stay reproducible.

## What is not covered

Bonuses and overtime, benefits in kind, loans and advances, pension and insurance relief, mortgage interest relief, disability exemption, mid-month joiners and leavers (pay is for a full month), unpaid leave reducing pay, casual and part-time workers, NITA levy, payslip PDFs, P9 forms and the iTax PAYE return file.

## Recovering staff debts

Staff who owe money from bill deductions (Staff debtors) can have it recovered through payroll, **capped at half of take-home pay** in any month. Kenyan employment law limits total deductions from wages (broadly to two-thirds of pay): confirm the right cap for your business.

## Accounting

One journal per run: debit Salaries (gross) and Employer statutory contributions; credit PAYE, NSSF, SHIF and Housing levy payable, Staff debtors (recoveries) and Net salaries payable. Paying salaries clears Net salaries payable. Remitting to KRA, NSSF, SHA and the housing fund clears each liability. Invariant I14 checks each run against its payslips.

## Sources checked (14 November 2026)

KPMG Kenya, *Phase 4 of NSSF contribution rates effective February 2026*; RSM East Africa, *NSSF new rates for 2026*; BDO East Africa, *NSSF new rates 2026*; Grant Thornton Kenya, *Tax alert 1 of 2026*; published PAYE guides for 2026 (bands, relief, SHIF and housing levy deductibility); Capital FM and allAfrica, October 2026, on the proposed PAYE changes. **Confirm against KRA, NSSF and SHA directly.**
