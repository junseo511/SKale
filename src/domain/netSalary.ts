export type SalaryUnit = 'annual' | 'monthly'

export interface NetSalaryInput {
  salaryUnit: SalaryUnit
  salaryAmount: number
  severanceIncluded: boolean
  dependents: number
  childrenUnderTwenty: number
  monthlyNonTaxableAmount: number
}

export interface NetSalaryDeductions {
  nationalPension: number
  healthInsurance: number
  longTermCareInsurance: number
  employmentInsurance: number
  incomeTax: number
  localIncomeTax: number
}

export interface NetSalaryEstimate {
  annualSalary: number
  monthlyGrossSalary: number
  monthlyTaxableSalary: number
  monthlyNetSalary: number
  totalDeductions: number
  deductions: NetSalaryDeductions
}

const NATIONAL_PENSION_EMPLOYEE_RATE = 0.0475
const HEALTH_INSURANCE_EMPLOYEE_RATE = 0.03595
const LONG_TERM_CARE_RATE = 0.1314
const EMPLOYMENT_INSURANCE_EMPLOYEE_RATE = 0.009
const NATIONAL_PENSION_MONTHLY_INCOME_MAXIMUM = 6_370_000

export function estimateNetSalary(
  input: NetSalaryInput,
): NetSalaryEstimate {
  const salaryAmount = positive(input.salaryAmount)
  const annualSalary =
    input.salaryUnit === 'monthly'
      ? salaryAmount * 12
      : input.severanceIncluded
        ? (salaryAmount * 12) / 13
        : salaryAmount
  const monthlyGrossSalary = annualSalary / 12
  const monthlyNonTaxableAmount = Math.min(
    positive(input.monthlyNonTaxableAmount),
    monthlyGrossSalary,
  )
  const monthlyTaxableSalary = Math.max(
    monthlyGrossSalary - monthlyNonTaxableAmount,
    0,
  )

  const nationalPension = roundTen(
    Math.min(
      monthlyTaxableSalary,
      NATIONAL_PENSION_MONTHLY_INCOME_MAXIMUM,
    ) * NATIONAL_PENSION_EMPLOYEE_RATE,
  )
  const healthInsurance = roundTen(
    monthlyTaxableSalary * HEALTH_INSURANCE_EMPLOYEE_RATE,
  )
  const longTermCareInsurance = roundTen(
    healthInsurance * LONG_TERM_CARE_RATE,
  )
  const employmentInsurance = roundTen(
    monthlyTaxableSalary * EMPLOYMENT_INSURANCE_EMPLOYEE_RATE,
  )
  const incomeTax = estimateMonthlyIncomeTax({
    annualTaxableSalary: monthlyTaxableSalary * 12,
    dependents: Math.max(Math.round(input.dependents), 1),
    childrenUnderTwenty: Math.max(
      Math.min(
        Math.round(input.childrenUnderTwenty),
        Math.round(input.dependents) - 1,
      ),
      0,
    ),
    annualNationalPension: nationalPension * 12,
  })
  const localIncomeTax = roundTen(incomeTax * 0.1)
  const deductions: NetSalaryDeductions = {
    nationalPension,
    healthInsurance,
    longTermCareInsurance,
    employmentInsurance,
    incomeTax,
    localIncomeTax,
  }
  const totalDeductions = Object.values(deductions).reduce(
    (total, amount) => total + amount,
    0,
  )

  return {
    annualSalary: Math.round(annualSalary),
    monthlyGrossSalary: Math.round(monthlyGrossSalary),
    monthlyTaxableSalary: Math.round(monthlyTaxableSalary),
    monthlyNetSalary: Math.max(
      Math.round(monthlyGrossSalary - totalDeductions),
      0,
    ),
    totalDeductions,
    deductions,
  }
}

function estimateMonthlyIncomeTax({
  annualTaxableSalary,
  dependents,
  childrenUnderTwenty,
  annualNationalPension,
}: {
  annualTaxableSalary: number
  dependents: number
  childrenUnderTwenty: number
  annualNationalPension: number
}): number {
  const earnedIncome = Math.max(
    annualTaxableSalary - calculateEarnedIncomeDeduction(annualTaxableSalary),
    0,
  )
  const personalDeduction = dependents * 1_500_000
  const taxableBase = Math.max(
    earnedIncome - personalDeduction - annualNationalPension,
    0,
  )
  const calculatedTax = calculateIncomeTax(taxableBase)
  const earnedIncomeTaxCredit = Math.min(
    calculatedTax <= 1_300_000
      ? calculatedTax * 0.55
      : 715_000 + (calculatedTax - 1_300_000) * 0.3,
    earnedIncomeTaxCreditLimit(annualTaxableSalary),
  )
  const childTaxCredit =
    childrenUnderTwenty === 0
      ? 0
      : childrenUnderTwenty === 1
        ? 150_000
        : childrenUnderTwenty === 2
          ? 350_000
          : 350_000 + (childrenUnderTwenty - 2) * 300_000
  const annualIncomeTax = Math.max(
    calculatedTax - earnedIncomeTaxCredit - childTaxCredit,
    0,
  )

  return roundTen(annualIncomeTax / 12)
}

function calculateEarnedIncomeDeduction(annualSalary: number): number {
  if (annualSalary <= 5_000_000) {
    return annualSalary * 0.7
  }
  if (annualSalary <= 15_000_000) {
    return 3_500_000 + (annualSalary - 5_000_000) * 0.4
  }
  if (annualSalary <= 45_000_000) {
    return 7_500_000 + (annualSalary - 15_000_000) * 0.15
  }
  if (annualSalary <= 100_000_000) {
    return 12_000_000 + (annualSalary - 45_000_000) * 0.05
  }
  return Math.min(
    14_750_000 + (annualSalary - 100_000_000) * 0.02,
    20_000_000,
  )
}

function calculateIncomeTax(taxableBase: number): number {
  if (taxableBase <= 14_000_000) {
    return taxableBase * 0.06
  }
  if (taxableBase <= 50_000_000) {
    return 840_000 + (taxableBase - 14_000_000) * 0.15
  }
  if (taxableBase <= 88_000_000) {
    return 6_240_000 + (taxableBase - 50_000_000) * 0.24
  }
  if (taxableBase <= 150_000_000) {
    return 15_360_000 + (taxableBase - 88_000_000) * 0.35
  }
  if (taxableBase <= 300_000_000) {
    return 37_060_000 + (taxableBase - 150_000_000) * 0.38
  }
  if (taxableBase <= 500_000_000) {
    return 94_060_000 + (taxableBase - 300_000_000) * 0.4
  }
  if (taxableBase <= 1_000_000_000) {
    return 174_060_000 + (taxableBase - 500_000_000) * 0.42
  }
  return 384_060_000 + (taxableBase - 1_000_000_000) * 0.45
}

function earnedIncomeTaxCreditLimit(annualSalary: number): number {
  if (annualSalary <= 33_000_000) {
    return 740_000
  }
  if (annualSalary <= 70_000_000) {
    return Math.max(
      740_000 - (annualSalary - 33_000_000) * 0.008,
      660_000,
    )
  }
  if (annualSalary <= 120_000_000) {
    return Math.max(
      660_000 - (annualSalary - 70_000_000) * 0.5,
      500_000,
    )
  }
  return Math.max(
    500_000 - (annualSalary - 120_000_000) * 0.5,
    200_000,
  )
}

function positive(value: number): number {
  return Number.isFinite(value) ? Math.max(value, 0) : 0
}

function roundTen(value: number): number {
  return Math.floor(value / 10) * 10
}
