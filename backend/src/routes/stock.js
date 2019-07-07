const StockName = require('../models/StockNameModel')
const StockPrice = require('../models/StockPriceModel')
const DividendName = require('../models/DividendNameModel')
const DividendPrice = require('../models/DividendPriceModel')
const alphavantage = require('../util/alphavantage')
const jwt = require('../util/jwt')
const express = require('express')
const router = express.Router()

function initPriceHistory(symbol) {
  StockPrice
    .deleteMany({ symbol })
    .then(done => {
      alphavantage
        .monthly
        .prices(symbol)
        .then(prices => {
          const maxYear = prices[0].date.getFullYear()
          const minYear = prices[prices.length - 1].date.getFullYear()

          const years = []
          for (let i = minYear; i <= maxYear; ++i) {
            years.push(i)
          }

          const buckets = new Map()
          years.forEach(year => buckets.set(year, new StockPrice({ symbol, year })))

          prices.forEach(price => {
            const year = price.date.getFullYear()
            const month = price.date.getMonth()
            const value = price.price
            const bucket = buckets.get(year)
            bucket.months.push({ date: price.date, price: value })
          })
          alphavantage
            .daily
            .prices(symbol)
            .then(prices => {
              prices.forEach(price => {
                const year = price.date.getFullYear()
                const month = price.date.getMonth()
                const date = price.date.getDate()
                const value = price.price
                const bucket = buckets.get(year)
                bucket.days.push({ date: price.date, price: value })
              })
              return buckets
            })
            .then(buckets => buckets.forEach(stockprice => stockprice.save()))
            .then(done => console.log(`initialized ${symbol} stock prices`))
            .catch(err => console.log(err))
        })
        .catch(err => console.log(err))
    })
    .catch(err => console.log(err))
}

function initDividendHistory(symbol) {
  DividendPrice
    .deleteMany({ symbol })
    .then(done => {
      alphavantage
        .monthlyAdjusted
        .dividends(symbol)
        .then(dividends => {
          const maxYear = dividends[0].date.getFullYear()
          const minYear = dividends[dividends.length - 1].date.getFullYear()

          const years = []
          for (let i = minYear; i <= maxYear; ++i) {
            years.push(i)
          }

          const buckets = new Map()
          years.forEach(year => buckets.set(year, new DividendPrice({ symbol, year })))

          dividends.forEach(dividend => {
            const year = dividend.date.getFullYear()
            const month = dividend.date.getMonth()
            const value = dividend.price
            const bucket = buckets.get(year)
            bucket.months.push({ date: dividend.date, price: value })
          })
          alphavantage
            .dailyAdjusted
            .dividends(symbol)
            .then(dividends => {
              dividends.forEach(dividend => {
                const year = dividend.date.getFullYear()
                const month = dividend.date.getMonth()
                const date = dividend.date.getDate()
                const value = dividend.price
                const bucket = buckets.get(year)
                bucket.days.push({ date: dividend.date, price: value })
              })
              return buckets
            })
            .then(buckets => buckets.forEach(dividendprice => dividendprice.save()))
            .then(done => console.log(`initialized ${symbol} dividends`))
            .catch(err => console.log(err))
        })
        .catch(err => console.log(err))
    })
    .catch(err => console.log(err))
}

function init(symbol) {
  initPriceHistory(symbol)
  initDividendHistory(symbol)
}

router.get('/intraday/latestprice', (req, res) => {
  jwt
    .verifyJWT(req.token)
    .then(auth => {
      const symbol = req.query.symbol
      alphavantage
        .intraday
        .latestprice(symbol)
        .then(latestprice => {
          res.status(200).json({
            message: `latest price ${latestprice.price} at time ${latestprice.date} (intraday)`,
            latestprice,
          })
        })
        .catch(err => res.sendStatus(500))
    })
    .catch(err => res.sendStatus(403))
})

router.post('/daily/latestprice', (req, res) => {
  jwt
    .verifyJWT(req.token)
    .then(auth => {
      const symbol = req.body.symbol
      StockName
        .findOne({ symbol: symbol })
        .then(stock => {
          if (stock) {
            res.status(200).json({
              message: `getting ${symbol} latest price (daily)`,
              stock,
            })
          } else {
            alphavantage
              .daily
              .latestprice(symbol)
              .then(latestprice => {
                const price = latestprice.price
                const stock = new StockName({
                  symbol,
                  price,
                })
                console.log(stock)
                res.status(200).json({
                  message: `getting ${symbol} latest price (daily)`,
                  stock,
                })
                stock.save()
                initPriceHistory(symbol)
              })
              .catch(err => res.sendStatus(500))
          }
        })
        .catch(err => res.sendStatus(500))
    })
    .catch(err => res.sendStatus(403))
})

router.post('/daily/price', (req, res) => {
  jwt
    .verifyJWT(req.token)
    .then(auth => {
      const symbol = req.body.symbol
      const ISOdate = req.body.date
      const year = ISOdate.split('-')[0]
      StockPrice
        .find({ symbol, year })
        .then(stockprice => {
          if (stockprice) {
            stockprice.days.forEach(day => {
              if (day.date.toISOString() === ISOdate) {
                const price = day
                res.status(200).json({
                  message: `getting ${symbol} price on ${ISOdate}`,
                  price,
                })
              }
            })
            res.sendStatus(404)
          } else {
            alphavantage
              .daily
              .prices(symbol)
              .then(prices => {
                prices.forEach(price => {
                  if (price.date.toISOString() === ISOdate) {
                    res.status(200).json({
                      message: `getting ${symbol} price on ${ISOdate}`,
                      price,
                    })
                  }
                  res.sendStatus(404)
                })
              })
              .catch(err => res.sendStatus(500))
          }
        })
        .catch(err => res.sendStatus(500))
    })
    .catch(err => res.sendStatus(403))
})

router.post('/pricerange', (req, res) => {
  jwt
    .verifyJWT(req.token)
    .then(auth => {
      const symbol = req.body.symbol
      const start = new Date(req.body.start)
      const end = new Date(req.body.end)
      const startyear = start.getFullYear()
      const endyear = end.getFullYear()
      const startmonth = start.getMonth()
      const endmonth = end.getMonth()
      StockPrice
        .range(symbol, start, end)
        .then(buckets => {
          const prices = {
            days: [],
            months: [],
          }
          if (buckets === []) {
            alphavantage
              .daily
              .prices_range(symbol, start, end)
              .then(dailypricerange => {
                prices.days = dailypricerange.filter(price => start <= price.date && price.date <= end)
                alphavantage
                  .monthly
                  .prices_range(symbol, start, end)
                  .then(monthlypricerange => {
                    prices.months = monthlypricerange.filter(price => {
                      const checklower = startyear === price.date.getFullYear()
                        ? startmonth <= price.date.getMonth()
                        : startyear < price.date.getFullYear()
                      const checkupper = endyear === price.date.getFullYear()
                        ? price.date.getMonth() <= endmonth
                        : price.date.getFullYear() < endyear
                      return checklower && checkupper
                    })
                  })
                  .then(done => {
                    res.status(200).json({
                      message: `${symbol} prices from ${start} to ${end}`,
                      prices,
                    })
                    initPriceHistory(symbol)
                  })
                  .catch(err => res.sendStatus(500))
              })
              .catch(err => res.sendStatus(500))
          } else {
            buckets.forEach(bucket => {
              const days = bucket.days
              const months = bucket.months
              days.forEach(day => {
                if (start <= day.date && day.date <= end) {
                  prices.days.push(day)
                }
              })
              months.forEach(month => {
                const checklower = startyear === month.date.getFullYear()
                  ? startmonth <= month.date.getMonth()
                  : startyear < month.date.getFullYear()
                const checkupper = endyear === month.date.getFullYear()
                  ? month.date.getMonth() <= endmonth
                  : month.date.getFullYear() < endyear
                if (checklower && checkupper) {
                  prices.months.push(month)
                }
              })
            })
            res.status(200).json({
              message: `${symbol} prices from ${start} to ${end}`,
              prices,
            })
          }
        })
        .catch(err => res.sendStatus(500))
    })
    .catch(err => res.sendStatus(403))
})

module.exports = router