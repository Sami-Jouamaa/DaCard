using System.Security.Cryptography;
using System.Text;

namespace DaCard.Server;

public static class CardCatalog
{
    public static readonly string[] RarityOrder = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];

    private const string IdSalt = "DaCard:";

    public static bool IsRarity(string value) => RarityOrder.Any(r => r.Equals(value, StringComparison.OrdinalIgnoreCase));

    public static string IdFor(string key)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(IdSalt + key.ToLowerInvariant()));
        return Convert.ToHexString(hash, 0, 12).ToLowerInvariant();
    }
}
