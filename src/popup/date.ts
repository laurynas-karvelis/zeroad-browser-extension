type FromOptions = {
  withoutSuffix?: boolean;
};

export function from(
  input: Date | number | string,
  base: Date | number | string = new Date(),
  options: FromOptions = {}
): string {
  const target = new Date(input).getTime();
  const now = new Date(base).getTime();

  const diff = target - now;
  const absDiff = Math.abs(diff);

  const seconds = absDiff / 1000;
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;
  const months = days / 30;
  const years = days / 365;

  const isFuture = diff > 0;
  const suffix = options.withoutSuffix ? "" : isFuture ? " in" : " ago";

  let result: string;

  if (seconds < 45) result = "a few seconds";
  else if (seconds < 90) result = "a minute";
  else if (minutes < 45) result = `${Math.round(minutes)} minutes`;
  else if (minutes < 90) result = "an hour";
  else if (hours < 22) result = `${Math.round(hours)} hours`;
  else if (hours < 36) result = "a day";
  else if (days < 26) result = `${Math.round(days)} days`;
  else if (days < 46) result = "a month";
  else if (days < 320) result = `${Math.round(months)} months`;
  else if (days < 548) result = "a year";
  else result = `${Math.round(years)} years`;

  if (options.withoutSuffix) {
    return result;
  }

  return isFuture ? `${suffix.trim()} ${result}` : `${result}${suffix}`;
}
