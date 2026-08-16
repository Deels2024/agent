export const carrierLabels: Record<string, string> = {
  cdek: "СДЭК",
  fivepost: "5Post",
  cse: "5Post / Курьер Сервис Экспресс",
  dpd: "DPD",
  boxberry: "Boxberry",
  postrf: "Почта России",
  russianpost: "Почта России",
  yandex: "Яндекс Доставка",
  yandexdelivery: "Яндекс Доставка",
  dostavista: "Достависта",
  dalli: "Dalli",
  iml: "IML",
  logsis: "Logsis",
  pek: "ПЭК",
  pickpoint: "PickPoint",
  seller_delivery: "Доставка продавца",
  self_pickup: "Самовывоз из магазина",
};

export function carrierLabel(provider: string) {
  return carrierLabels[provider.toLowerCase()] ?? provider.toUpperCase();
}

export const supportedDeliveryNetwork = [
  { key: "cdek", label: "СДЭК", modes: ["ПВЗ", "курьер"] },
  { key: "fivepost", label: "5Post", modes: ["ПВЗ", "постаматы"] },
  { key: "russianpost", label: "Почта России", modes: ["отделения", "курьер"] },
  { key: "yandex", label: "Яндекс Доставка", modes: ["экспресс", "по России"] },
  { key: "dpd", label: "DPD", modes: ["ПВЗ", "курьер"] },
  { key: "dalli", label: "Dalli", modes: ["курьер", "интервалы"] },
  { key: "seller_delivery", label: "Доставка продавца", modes: ["курьер"] },
  { key: "self_pickup", label: "Самовывоз", modes: ["из магазина"] },
];
