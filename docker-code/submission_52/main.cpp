#include <iostream>
#include <sstream>
#include <algorithm>
#include <climits>
using namespace std;

int main() {
    string input;
    getline(cin, input);

    input.erase(std::remove(input.begin(), input.end(), '['), input.end());
    input.erase(std::remove(input.begin(), input.end(), ']'), input.end());

    stringstream ss(input);
    string token;

    int minPrice = INT_MAX;
    int maxProfit = 0;

    while (getline(ss, token, ',')) {
        int price = stoi(token);
        if (price < minPrice) {
            minPrice = price;
        } else {
            maxProfit = max(maxProfit, price - minPrice);
        }
    }

    cout << maxProfit;
    return 0;
}