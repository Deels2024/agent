import { hasRuntimeBinding, hasRuntimeValue, runtimeValue } from "./runtime";

export type PlatformModuleStatus = "ready" | "sandbox" | "needs_configuration" | "external_contract";

export type PlatformModule = {
  id: number;
  key: string;
  title: string;
  description: string;
  status: PlatformModuleStatus;
  implemented: boolean;
  missing: string[];
  route?: string;
};

function configured(required: string[]) {
  return required.every(hasRuntimeValue);
}

export function platformModules(): PlatformModule[] {
  const dbReady = hasRuntimeBinding("DB");
  const paymentProvider = runtimeValue("PAYMENT_PROVIDER");
  const paymentModel = runtimeValue("PAYMENT_MODEL");
  const paymentModelReady = ["seller_direct", "bank_safe_deal", "split_payment"].includes(paymentModel ?? "");
  const paymentReady = paymentProvider === "webhook" && paymentModelReady && configured(["PAYMENT_API_URL", "PAYMENT_API_KEY"]);
  const paymentSandbox = paymentProvider === "sandbox";
  const legalReady = runtimeValue("LEGAL_OPERATOR_REQUISITES_CONFIRMED") === "true" && runtimeValue("PRIVACY_PROCESSORS_CONFIRMED") === "true";
  const modules: PlatformModule[] = [
    { id: 1, key: "identity", title: "Вход покупателей и продавцов", description: "Серверная идентификация, профиль и защищённые операции.", status: "ready", implemented: true, missing: [], route: "/account" },
    { id: 2, key: "roles", title: "Роли и права", description: "Покупатель, продавец и администратор с проверкой прав на сервере.", status: hasRuntimeValue("ADMIN_EMAILS") ? "ready" : "needs_configuration", implemented: true, missing: hasRuntimeValue("ADMIN_EMAILS") ? [] : ["ADMIN_EMAILS"] },
    { id: 3, key: "seller", title: "Кабинет продавца", description: "Профиль магазина, ассортимент, остатки и подключения площадок.", status: dbReady ? "ready" : "needs_configuration", implemented: true, missing: dbReady ? [] : ["DB"], route: "/seller" },
    { id: 4, key: "credentials", title: "Защита ключей продавцов", description: "Ключи сохраняются только в зашифрованном виде и никогда не возвращаются в интерфейс.", status: hasRuntimeValue("CREDENTIAL_ENCRYPTION_KEY") ? "ready" : "needs_configuration", implemented: true, missing: hasRuntimeValue("CREDENTIAL_ENCRYPTION_KEY") ? [] : ["CREDENTIAL_ENCRYPTION_KEY"] },
    { id: 5, key: "orders", title: "Заказы и безопасная сделка", description: "Заказ, статусы оплаты, доставки, защиты и спора в едином журнале.", status: dbReady ? "ready" : "needs_configuration", implemented: true, missing: dbReady ? [] : ["DB"], route: "/account" },
    { id: 6, key: "payments", title: "Оплата, возвраты и выплаты", description: "Контур идемпотентных платёжных намерений готов; движение денег включается после договора с провайдером и выбора агентской платёжной модели.", status: paymentReady ? "ready" : paymentSandbox ? "sandbox" : "external_contract", implemented: true, missing: paymentReady || paymentSandbox ? [] : ["PAYMENT_PROVIDER", "PAYMENT_MODEL", "PAYMENT_API_URL", "PAYMENT_API_KEY"] },
    { id: 7, key: "kyc", title: "Проверка продавцов", description: "Статусы KYC, риск-оценка и ручная проверка с полным журналом действий.", status: configured(["KYC_PROVIDER", "KYC_API_KEY"]) ? "ready" : "external_contract", implemented: true, missing: configured(["KYC_PROVIDER", "KYC_API_KEY"]) ? [] : ["KYC_PROVIDER", "KYC_API_KEY"] },
    { id: 8, key: "delivery", title: "Доставка и отслеживание", description: "Единая модель отправления, ETA и ссылка отслеживания; перевозчик подключается адаптером.", status: configured(["DELIVERY_PROVIDER", "DELIVERY_API_KEY"]) ? "ready" : "external_contract", implemented: true, missing: configured(["DELIVERY_PROVIDER", "DELIVERY_API_KEY"]) ? [] : ["DELIVERY_PROVIDER", "DELIVERY_API_KEY"] },
    { id: 9, key: "notifications", title: "Email, SMS и push", description: "Очередь уведомлений уже хранится в базе; отправка активируется единым защищённым шлюзом.", status: configured(["NOTIFICATION_WEBHOOK_URL", "NOTIFICATION_WEBHOOK_SECRET"]) ? "ready" : "needs_configuration", implemented: true, missing: configured(["NOTIFICATION_WEBHOOK_URL", "NOTIFICATION_WEBHOOK_SECRET"]) ? [] : ["NOTIFICATION_WEBHOOK_URL", "NOTIFICATION_WEBHOOK_SECRET"] },
    { id: 10, key: "subscriptions", title: "Подписка Plus", description: "Тариф, пробный период и жизненный цикл подписки связаны с платёжным контуром.", status: paymentReady ? "ready" : "sandbox", implemented: true, missing: paymentReady ? [] : ["PAYMENT_PROVIDER", "PAYMENT_API_URL", "PAYMENT_API_KEY"] },
    { id: 11, key: "price_alerts", title: "Контроль снижения цены", description: "Покупатель задаёт целевую цену, агент сохраняет правило и готовит уведомление.", status: dbReady ? "ready" : "needs_configuration", implemented: true, missing: dbReady ? [] : ["DB"], route: "/account" },
    { id: 12, key: "risk", title: "Антифрод и лимиты", description: "Лимиты запросов, риск-события, хеширование сетевых признаков и аудит операций.", status: dbReady ? "ready" : "needs_configuration", implemented: true, missing: dbReady ? [] : ["DB"] },
    { id: 13, key: "operations", title: "Мониторинг и резервирование", description: "Health-check и журнал событий готовы; внешние оповещения и политика резервирования настраиваются перед запуском.", status: configured(["MONITORING_WEBHOOK_URL", "BACKUP_POLICY_CONFIRMED"]) ? "ready" : "needs_configuration", implemented: true, missing: configured(["MONITORING_WEBHOOK_URL", "BACKUP_POLICY_CONFIRMED"]) ? [] : ["MONITORING_WEBHOOK_URL", "BACKUP_POLICY_CONFIRMED"] },
    { id: 14, key: "legal", title: "Документы сервиса", description: "Оферта, отдельные согласия, правила продавцов и безопасной сделки реализованы; до коммерческого запуска нужны реквизиты оператора, фактические обработчики и финальная юридическая проверка.", status: legalReady ? "ready" : "needs_configuration", implemented: true, missing: legalReady ? [] : ["LEGAL_OPERATOR_REQUISITES_CONFIRMED=true", "PRIVACY_PROCESSORS_CONFIRMED=true"], route: "/legal" },
    { id: 15, key: "launch", title: "Домен и публичный запуск", description: "Проект поддерживает собственный адрес и публичный режим; включаются после проверки ключей и документов.", status: configured(["PUBLIC_APP_URL", "PUBLIC_ACCESS_ENABLED"]) && runtimeValue("PUBLIC_ACCESS_ENABLED") === "true" ? "ready" : "needs_configuration", implemented: true, missing: [!hasRuntimeValue("PUBLIC_APP_URL") ? "PUBLIC_APP_URL" : "", runtimeValue("PUBLIC_ACCESS_ENABLED") !== "true" ? "PUBLIC_ACCESS_ENABLED=true" : ""].filter(Boolean) },
  ];
  return modules;
}

export function platformSummary() {
  const modules = platformModules();
  return {
    implemented: modules.filter((module) => module.implemented).length,
    ready: modules.filter((module) => module.status === "ready").length,
    needsConfiguration: modules.filter((module) => module.status === "needs_configuration").length,
    externalContracts: modules.filter((module) => module.status === "external_contract").length,
    sandbox: modules.filter((module) => module.status === "sandbox").length,
    total: modules.length,
  };
}
