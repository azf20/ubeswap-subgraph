/* eslint-disable prefer-const */
import { Address, BigDecimal, BigInt } from "@graphprotocol/graph-ts/index";
import { Pair, Token, PairLookup } from "../types/schema";
import { ADDRESS_ZERO, factoryContract, ONE_BD, ZERO_BD } from "./helpers";

const CUSD_CELO_PAIR = "0x1e593f1fe7b61c53874b54ec0c59fd0d5eb8621e"; // Created at block 5272605
export const CELO_ADDRESS = "0x471ece3750da237f93b8e339c536989b8978a438";
const MCELO_ADDRESS = "0x7037f7296b2fc7908de7b57a89efaa8319f0c500";
const MCUSD_ADDRESS = "0x64defa3544c695db8c535d289d843a189aa26b98";
const MCEUR_ADDRESS = "0xa8d0e6799ff3fd19c6459bf02689ae09c4d78ba7";
const UBE_ADDRESS = "0x00be915b9dcf56a3cbe739d9b9c202ca692409ec";
const CUSD_ADDRESS = "0x765de816845861e75a25fca122bb6898b8b1282a";
const CEUR_ADDRESS = "0xd8763cba276a3738e6de85b4b3bf5fded6d6ca73";

export function getCeloPriceInUSD(): BigDecimal {
  // fetch celo prices for each stablecoin
  let cusdPair = Pair.load(CUSD_CELO_PAIR); // cusd is token1
  if (!cusdPair) {
    return ZERO_BD;
  }
  return cusdPair.token1Price.times(ONE_BD);
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  CELO_ADDRESS,
  CUSD_ADDRESS,
  MCELO_ADDRESS,
  MCUSD_ADDRESS,
  CEUR_ADDRESS,
  MCEUR_ADDRESS,
  UBE_ADDRESS,
];

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString("10000");

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_CUSD = BigDecimal.fromString("10000");

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived CELO (add stablecoin estimates)
 **/
export function findUsdPerToken(token: Token): BigDecimal {
  if (
    token.id == CUSD_ADDRESS ||
    // hard-code moola to $1
    token.id === MCUSD_ADDRESS
  ) {
    return ONE_BD;
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairLookup = PairLookup.load(token.id.concat("-").concat(WHITELIST[i]));
    //    let pairAddress = factoryContract.getPair(
    //      Address.fromString(token.id),
    //      Address.fromString(WHITELIST[i])
    //    );
    if (pairLookup == null) {
      let pairAddress = factoryContract.getPair(
        Address.fromString(token.id),
        Address.fromString(WHITELIST[i])
      );
      if (pairAddress.toHexString() != ADDRESS_ZERO) {
        pairLookup = new PairLookup(token.id.concat("-").concat(WHITELIST[i]));
        pairLookup.pairAddress = pairAddress.toHexString();
        pairLookup.save();
      }
    }

    if (pairLookup !== null) {
      let pair = Pair.load(pairLookup.pairAddress);
      if (
        pair.token0 == token.id &&
        pair.reserveUSD.gt(MINIMUM_LIQUIDITY_THRESHOLD_CUSD)
      ) {
        let token1 = Token.load(pair.token1);
        return pair.token1Price.times(token1.derivedCUSD as BigDecimal); // return token1 per our token * Eth per token 1
      }
      if (
        pair.token1 == token.id &&
        pair.reserveUSD.gt(MINIMUM_LIQUIDITY_THRESHOLD_CUSD)
      ) {
        let token0 = Token.load(pair.token0);
        return pair.token0Price.times(token0.derivedCUSD as BigDecimal); // return token0 per our token * CELO per token 0
      }
    }
  }
  return ZERO_BD; // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let price0 = token0.derivedCUSD.times(ONE_BD);
  let price1 = token1.derivedCUSD.times(ONE_BD);

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0);
    let reserve1USD = pair.reserve1.times(price1 || ZERO_BD);
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD;
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (
        reserve0USD
          .times(BigDecimal.fromString("2"))
          .lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)
      ) {
        return ZERO_BD;
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (
        reserve1USD
          .times(BigDecimal.fromString("2"))
          .lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)
      ) {
        return ZERO_BD;
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString("2"));
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0);
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1);
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD;
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let price0 = token0.derivedCUSD.times(ONE_BD);
  let price1 = token1.derivedCUSD.times(ONE_BD);

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1));
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString("2"));
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString("2"));
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD;
}
