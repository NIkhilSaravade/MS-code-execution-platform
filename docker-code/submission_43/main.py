import sys
import ast

prices = ast.literal_eval(sys.stdin.read().strip())

min_price = float('inf')
max_profit = 0

for price in prices:
    if price < min_price:
        min_price = price
    else:
        max_profit = max(max_profit, price - min_price)

print(max_profit)