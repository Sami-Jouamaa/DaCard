using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace DaCard.Editor
{
    public static class CardModelInspector
    {
        [MenuItem("DaCard/Inspect Card Model")]
        public static void Inspect()
        {
            var mesh = AssetDatabase.LoadAllAssetsAtPath(CardPaths.Model).OfType<Mesh>().FirstOrDefault();
            if (mesh == null)
            {
                Debug.LogError("[DaCard] No mesh found in " + CardPaths.Model);
                return;
            }

            var sb = new StringBuilder();
            sb.AppendLine($"[DaCard] Mesh '{mesh.name}': {mesh.vertexCount} verts, {mesh.triangles.Length / 3} tris, {mesh.subMeshCount} submeshes, bounds {mesh.bounds.center} size {mesh.bounds.size:F4}");
            sb.AppendLine($"  tangents: {mesh.tangents.Length > 0}, uv2: {mesh.uv2.Length > 0}");

            var normals = mesh.normals;
            var uvs = mesh.uv;
            var verts = mesh.vertices;
            var groups = Enumerable.Range(0, mesh.vertexCount).GroupBy(i => DominantAxis(normals[i]));
            foreach (var g in groups.OrderBy(g => g.Key))
            {
                var idx = g.ToArray();
                var uMin = idx.Min(i => uvs[i].x); var uMax = idx.Max(i => uvs[i].x);
                var vMin = idx.Min(i => uvs[i].y); var vMax = idx.Max(i => uvs[i].y);
                sb.AppendLine($"  face {g.Key}: {idx.Length} verts, uv x[{uMin:F3}..{uMax:F3}] y[{vMin:F3}..{vMax:F3}]");
                foreach (var i in idx.OrderBy(i => verts[i].x).ThenBy(i => verts[i].y).ThenBy(i => verts[i].z).Take(4))
                    sb.AppendLine($"    pos {verts[i]:F4} -> uv {uvs[i]:F3}");
            }

            Debug.Log(sb.ToString());
        }

        private static string DominantAxis(Vector3 n)
        {
            var a = new Vector3(Mathf.Abs(n.x), Mathf.Abs(n.y), Mathf.Abs(n.z));
            if (a.x >= a.y && a.x >= a.z) return n.x > 0 ? "+X" : "-X";
            if (a.y >= a.z) return n.y > 0 ? "+Y" : "-Y";
            return n.z > 0 ? "+Z" : "-Z";
        }
    }
}
