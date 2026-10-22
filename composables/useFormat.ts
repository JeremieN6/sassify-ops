const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const euroPrecise = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const number = new Intl.NumberFormat('fr-FR')

export function useFormat() {
  return {
    eur: (value: number) => euro.format(value),
    eurPrecise: (value: number) => euroPrecise.format(value),
    num: (value: number) => number.format(value),
    dateTime: (iso: string) =>
      new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }
}
