#include <stdio.h>

int main(void) {
    int n;
    printf("Scrivi un numero: ");
    fflush(stdout);
    if (scanf("%d", &n) != 1) return 1;
    printf("%d\n", n * 2);
    return 0;
}
