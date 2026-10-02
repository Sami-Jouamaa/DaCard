using System.Diagnostics;
using System.Threading.Tasks;
using UnityEngine;

namespace DaCard.Client
{
    internal static class FrameBudget
    {
        private const double Milliseconds = 6;

        private static readonly Stopwatch Clock = Stopwatch.StartNew();
        private static int _frame = -1;
        private static double _spent;

        public static async Task Turn()
        {
            while (true)
            {
                Reset();
                if (_spent < Milliseconds)
                    return;
                await Task.Yield();
            }
        }

        public static long Start() => Clock.ElapsedTicks;

        public static void Spend(long start)
        {
            Reset();
            _spent += (Clock.ElapsedTicks - start) * 1000.0 / Stopwatch.Frequency;
        }

        private static void Reset()
        {
            if (_frame == Time.frameCount)
                return;
            _frame = Time.frameCount;
            _spent = 0;
        }
    }
}
