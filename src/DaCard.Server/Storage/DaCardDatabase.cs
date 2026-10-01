using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using SPTarkov.DI.Annotations;
using Path = System.IO.Path;

namespace DaCard.Server.Storage;

[Injectable(InjectionType.Singleton)]
public class DaCardDatabase
{
    public const int SchemaVersion = 3;
    public const string FileName = "dacard.db";

    private static bool _nativeReady;
    private static readonly object NativeLock = new();

    private string? _connectionString;

    public string ModPath { get; private set; } = "";
    public string DataDir => Path.Combine(ModPath, "data");
    public string FilePath => Path.Combine(DataDir, FileName);
    public bool IsOpen => _connectionString != null;

    public static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public string? Open(string modPath)
    {
        ModPath = modPath;
        _connectionString = null;
        if (!File.Exists(FilePath))
            return $"{Path.Combine("data", FileName)} is missing";
        var error = EnsureNative(modPath);
        if (error != null)
            return error;
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = FilePath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private,
            DefaultTimeout = 30
        }.ToString();
        var version = Scalar<long>("PRAGMA user_version");
        if (version > SchemaVersion)
        {
            _connectionString = null;
            return $"the database is from a newer DaCard (schema {version}, this one reads {SchemaVersion}). Update DaCard";
        }
        if (version < SchemaVersion)
        {
            _connectionString = null;
            return $"the database is out of date (schema {version}, needs {SchemaVersion}); open the DaCard dashboard once to update it";
        }
        return null;
    }

    private static string? EnsureNative(string modPath)
    {
        lock (NativeLock)
        {
            if (_nativeReady)
                return null;
            var (rid, file) = NativeTarget();
            if (rid == null)
                return $"no SQLite library for this system ({RuntimeInformation.OSDescription}, {RuntimeInformation.ProcessArchitecture})";
            var path = Path.Combine(modPath, "runtimes", rid, "native", file);
            if (!File.Exists(path))
                return $"runtimes/{rid}/native/{file} is missing (reinstall DaCard)";
            var provider = typeof(SQLitePCL.SQLite3Provider_e_sqlite3).Assembly;
            NativeLibrary.SetDllImportResolver(provider, (name, _, _) =>
                name.Contains("e_sqlite3", StringComparison.OrdinalIgnoreCase) ? NativeLibrary.Load(path) : IntPtr.Zero);
            SQLitePCL.raw.SetProvider(new SQLitePCL.SQLite3Provider_e_sqlite3());
            _nativeReady = true;
            return null;
        }
    }

    private static (string? Rid, string File) NativeTarget()
    {
        var arch = RuntimeInformation.ProcessArchitecture switch
        {
            Architecture.X64 => "x64",
            Architecture.Arm64 => "arm64",
            _ => null
        };
        if (arch == null)
            return (null, "");
        if (OperatingSystem.IsWindows())
            return arch == "x64" ? ("win-x64", "e_sqlite3.dll") : (null, "");
        if (OperatingSystem.IsLinux())
            return ($"linux-{arch}", "libe_sqlite3.so");
        if (OperatingSystem.IsMacOS())
            return ($"osx-{arch}", "libe_sqlite3.dylib");
        return (null, "");
    }

    public SqliteConnection Connect()
    {
        if (_connectionString == null)
            throw new InvalidOperationException("The DaCard database is not open");
        var connection = new SqliteConnection(_connectionString);
        connection.Open();
        return connection;
    }

    public List<T> Query<T>(string sql, Func<SqliteDataReader, T> map, params (string Name, object? Value)[] parameters)
    {
        using var connection = Connect();
        using var command = Command(connection, sql, parameters);
        using var reader = command.ExecuteReader();
        var rows = new List<T>();
        while (reader.Read())
            rows.Add(map(reader));
        return rows;
    }

    public T? One<T>(string sql, Func<SqliteDataReader, T> map, params (string Name, object? Value)[] parameters) where T : class =>
        Query(sql, map, parameters).FirstOrDefault();

    public T Scalar<T>(string sql, params (string Name, object? Value)[] parameters)
    {
        using var connection = Connect();
        using var command = Command(connection, sql, parameters);
        var value = command.ExecuteScalar();
        return value is null or DBNull ? default! : (T)Convert.ChangeType(value, typeof(T));
    }

    private static SqliteCommand Command(SqliteConnection connection, string sql, (string Name, object? Value)[] parameters)
    {
        var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
            command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return command;
    }

    public static string? Text(SqliteDataReader reader, string column)
    {
        var i = reader.GetOrdinal(column);
        return reader.IsDBNull(i) ? null : reader.GetString(i);
    }

    public static double Number(SqliteDataReader reader, string column, double fallback = 0)
    {
        var i = reader.GetOrdinal(column);
        return reader.IsDBNull(i) ? fallback : reader.GetDouble(i);
    }

    public static double? Optional(SqliteDataReader reader, string column)
    {
        var i = reader.GetOrdinal(column);
        return reader.IsDBNull(i) ? null : Math.Clamp(reader.GetDouble(i), 0, 1);
    }

    public static bool Flag(SqliteDataReader reader, string column)
    {
        var i = reader.GetOrdinal(column);
        return !reader.IsDBNull(i) && reader.GetInt64(i) != 0;
    }

    public static T? FromJson<T>(SqliteDataReader reader, string column) where T : class
    {
        var text = Text(reader, column);
        if (string.IsNullOrWhiteSpace(text))
            return null;
        try
        {
            return JsonSerializer.Deserialize<T>(text, Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static string AssemblyFolder() => Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? "";
}
