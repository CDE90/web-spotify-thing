// import { and, gte, lte } from "drizzle-orm";
// import { listeningHistory } from "@/server/db/schema";
import { DateSelector } from "@/components/ui/DateSelector";

export default async function DashboardPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[]>>;
}) {
    const actualParams = await searchParams;

    // @ts-expect-error this is fine
    const searchParamsCopy = new URLSearchParams(actualParams);

    // Get the start date and end date from the search params
    const startDate = searchParamsCopy.get("from")
        ? new Date(searchParamsCopy.get("from")!)
        : new Date(new Date().getTime() - 365 * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);
    const endDate = searchParamsCopy.get("to")
        ? new Date(searchParamsCopy.get("to")!)
        : new Date();
    endDate.setHours(23, 59, 59, 999);

    // const timeFilters = and(
    //     gte(listeningHistory.playedAt, startDate),
    //     lte(listeningHistory.playedAt, endDate),
    // );

    return (
        <div>
            <h1>Dashboard</h1>
            <p>
                {startDate.toISOString()} - {endDate.toISOString()}
            </p>
            <DateSelector baseUrl={"http://localhost:3000"} />
        </div>
    );
}
