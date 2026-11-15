# Un progetto col suo Makefile: compila con gcc, il programma si chiama ciao.

CC      = gcc
CFLAGS  = -std=c11 -pedantic -Wall -Wextra -g -O0
TARGET  = ciao

all: $(TARGET)

$(TARGET): main.c
	$(CC) $(CFLAGS) -o $(TARGET) main.c

clean:
	rm -f $(TARGET) $(TARGET).exe

.PHONY: all clean
