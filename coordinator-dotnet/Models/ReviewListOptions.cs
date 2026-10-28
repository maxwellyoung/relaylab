using System.Globalization;

namespace RelayLab.Coordinator.Models;

// A missing page/pageSize pair preserves the legacy, unbounded array response.
// Status filtering works independently of paging for existing clients.
public sealed record ReviewListOptions(string? Status, int? Page, int? PageSize)
{
    public bool IsPaged => Page.HasValue;
    public int Offset => IsPaged ? checked((Page!.Value - 1) * PageSize!.Value) : 0;

    public static ReviewListOptions Parse(string? status, string? page, string? pageSize)
    {
        if (status is not null && status is not ("pending" or "approved" or "rejected"))
            throw new ApiFailure(400, "status must be pending, approved or rejected");

        if ((page is null) != (pageSize is null))
            throw new ApiFailure(400, "page and pageSize must be supplied together");

        if (page is null)
            return new(status, null, null);

        if (!int.TryParse(page, NumberStyles.None, CultureInfo.InvariantCulture, out var parsedPage) || parsedPage < 1)
            throw new ApiFailure(400, "page must be a positive integer");
        if (!int.TryParse(pageSize, NumberStyles.None, CultureInfo.InvariantCulture, out var parsedSize) || parsedSize is < 1 or > 100)
            throw new ApiFailure(400, "pageSize must be an integer from 1 to 100");
        if ((long)(parsedPage - 1) * parsedSize > int.MaxValue)
            throw new ApiFailure(400, "Requested page offset is too large");

        return new(status, parsedPage, parsedSize);
    }
}
