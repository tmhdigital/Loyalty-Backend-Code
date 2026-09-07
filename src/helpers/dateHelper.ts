export const calculateEndDate = (duration: string, fromDate: Date = new Date()): Date => {
  const endDate = new Date(fromDate);

  switch (duration) {
    case "1 month":
      endDate.setMonth(endDate.getMonth() + 1);
      break;
    case "4 months":
      endDate.setMonth(endDate.getMonth() + 4);
      break;
    case "8 months":
      endDate.setMonth(endDate.getMonth() + 8);
      break;
    case "1 year":
      endDate.setFullYear(endDate.getFullYear() + 1);
      break;
    default:
      throw new Error("Invalid package duration");
  }

  return endDate;
};
